import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { rawJobFromManual } from "@job-search-os/pipeline";
import { eq, and } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import { createFakeLlm } from "../llm/fake";
import { createPgQueue, enqueueEvaluationWith } from "../queue/pg-queue";
import { evaluateJobById } from "./evaluate-job";

/** R7-2 · no reevaluar duplicados, contra Postgres real, con FakeLlm (sin red) y datos ficticios. */
const USER = "a7000000-0000-4000-8000-000000000002";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const fakeEvaluation = {
  score: 8,
  confianza: "alta",
  years_required: 4,
  years_domain: "desarrollo de software",
  years_discipline: "ai_engineer",
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "ai_engineer",
  ingles_requerido: "intermedio",
  tipo_empresa: "startup",
  paises_permitidos: ["AR", "CL"],
  match_fuerte: ["RAG", "MCP"],
  gaps: [{ skill: "AWS", nivel: "must" }],
  riesgos: [],
  bloqueadores_duros: [],
  senales_positivas: ["pocos candidatos"],
  veredicto: "Match alto.",
  accion_sugerida: "aplicar",
};

beforeAll(async () => {
  let ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 4 });
  await conn.db
    .insert(s.users)
    .values({ id: USER, email: "r72@ejemplo.test" })
    .onConflictDoNothing();
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Ficticia",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_r72@ingest.test",
      profileSummary: "AI Engineer con RAG y agentes.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

const raw = (n: number) =>
  rawJobFromManual({
    title: "AI Engineer",
    company: `Empresa R72-${n}`,
    locationRaw: "Remoto (Argentina)",
    modality: "remoto",
    jdText: `Buscamos AI Engineer ficticio ${n} con RAG, agentes y MCP. Remoto para Argentina.`,
    url: `https://ejemplo.test/r72/${n}`,
  });

/** Ingesta un aviso, lo evalúa con el modelo y devuelve un clon (mismo hash, otro id) sin evaluar. */
async function evaluatedAndClone(n: number) {
  const q = createPgQueue(conn.db);
  const out = await ingestRawJob(raw(n), {
    db: conn.db,
    userId: USER,
    rules: criteria as never,
    logger,
    enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
  });
  const [before] = await conn.db
    .select({ status: s.jobs.status })
    .from(s.jobs)
    .where(eq(s.jobs.id, out.jobId));
  const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
  const first = await evaluateJobById(out.jobId, { db: conn.db, llm, queue: q, logger });
  expect(first).toMatchObject({ ok: true });
  expect(llm.calls).toHaveLength(1);
  const [orig] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, out.jobId));
  const { id: _id, jdShingles: _sh, canonicalUrl: _url, createdAt: _c, ...rest } = orig!;
  const [clone] = await conn.db
    .insert(s.jobs)
    .values({ ...rest, canonicalUrl: null, status: before!.status, duplicateOfId: null })
    .returning({ id: s.jobs.id });
  return { q, original: out.jobId, clone: clone!.id, status: before!.status };
}

describe("no reevaluar duplicados (R7-2)", () => {
  it("mismo hash, perfil y criterios sin cambios: copia la evaluación, sin llamar al modelo", async () => {
    const { q, original, clone } = await evaluatedAndClone(1);
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const res = await evaluateJobById(clone, { db: conn.db, llm, queue: q, logger });
    expect(llm.calls).toHaveLength(0);
    if (!res.ok) throw new Error(`evaluación falló: ${res.error}`);
    expect(res).toMatchObject({ ok: true, costUsd: 0, status: "evaluada" });
    const [ev] = await conn.db.select().from(s.evaluations).where(eq(s.evaluations.jobId, clone));
    const [prev] = await conn.db
      .select()
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, original));
    expect(ev).toMatchObject({
      model: prev!.model,
      promptVersion: prev!.promptVersion,
      score: prev!.score,
    });
    expect((ev!.decision as { reused_from?: string }).reused_from).toBe(prev!.id);
  });

  it("si el perfil cambió después de la evaluación previa, vuelve a llamar al modelo", async () => {
    const { q, clone } = await evaluatedAndClone(2);
    await conn.db
      .update(s.profiles)
      .set({ updatedAt: new Date() })
      .where(eq(s.profiles.userId, USER));
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const res = await evaluateJobById(clone, { db: conn.db, llm, queue: q, logger });
    expect(res).toMatchObject({ ok: true });
    expect(llm.calls).toHaveLength(1);
    const [ev] = await conn.db.select().from(s.evaluations).where(eq(s.evaluations.jobId, clone));
    expect((ev!.decision as { reused_from?: string }).reused_from).toBeUndefined();
  });

  it("si los criterios tienen una versión nueva, vuelve a llamar al modelo", async () => {
    const { q, clone } = await evaluatedAndClone(3);
    await conn.db
      .insert(s.evaluationCriteria)
      .values({ userId: USER, version: 2, active: true, rules: criteria as never });
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    await evaluateJobById(clone, { db: conn.db, llm, queue: q, logger });
    expect(llm.calls).toHaveLength(1);
    await conn.db
      .delete(s.evaluationCriteria)
      .where(and(eq(s.evaluationCriteria.userId, USER), eq(s.evaluationCriteria.version, 2)));
  });

  it("si cambió un dato del aviso (título), vuelve a llamar al modelo", async () => {
    const { q, clone } = await evaluatedAndClone(4);
    await conn.db.update(s.jobs).set({ title: "AI Engineer Senior" }).where(eq(s.jobs.id, clone));
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    await evaluateJobById(clone, { db: conn.db, llm, queue: q, logger });
    expect(llm.calls).toHaveLength(1);
  });

  it("no reutiliza evaluaciones de otra persona con el mismo hash", async () => {
    const OTHER = "a7000000-0000-4000-8000-000000000003";
    await conn.db
      .insert(s.users)
      .values({ id: OTHER, email: "r72b@ejemplo.test" })
      .onConflictDoNothing();
    await conn.db
      .insert(s.profiles)
      .values({
        userId: OTHER,
        displayName: "Ficticio",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: "u_r72b@ingest.test",
        profileSummary: "Otro perfil.",
      })
      .onConflictDoNothing();
    await conn.db
      .insert(s.evaluationCriteria)
      .values({ userId: OTHER, version: 1, active: true, rules: criteria as never })
      .onConflictDoNothing();
    const { q, original, status } = await evaluatedAndClone(5);
    const [orig] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, original));
    const { id: _id, jdShingles: _sh, canonicalUrl: _url, createdAt: _c, ...rest } = orig!;
    const [theirs] = await conn.db
      .insert(s.jobs)
      .values({ ...rest, userId: OTHER, canonicalUrl: null, status })
      .returning({ id: s.jobs.id });
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    await evaluateJobById(theirs!.id, { db: conn.db, llm, queue: q, logger });
    expect(llm.calls).toHaveLength(1);
  });
});
