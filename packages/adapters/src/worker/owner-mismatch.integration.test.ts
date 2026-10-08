import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import type { RawJob } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import { createFakeLlm } from "../llm/fake";
import { createPgQueue, EVALUATE_QUEUE } from "../queue/pg-queue";
import { runEvaluateWorker } from "./evaluate-job";

/**
 * Seguridad H-4 (ronda 18): un mensaje encolado por B que apunta al job de A se descarta antes
 * de llamar al LLM, sin gastar cupo de A ni de B. Cliente falso: cero llamadas pagas.
 */
const A = "a5000000-0000-4000-8000-000000000001";
const B = "b6000000-0000-4000-8000-000000000002";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const raw = (externalId: string): RawJob => ({
  source: {
    kind: "getonboard_api",
    name: "Fuente A",
    externalId,
    url: `https://example.test/jobs/${externalId}`,
    rawRef: null,
  },
  title: "AI Engineer",
  companyRaw: `Empresa ${externalId}`,
  locationRaw: "Remoto (Argentina, Chile)",
  countriesAllowed: ["AR", "CL"],
  modality: "remoto",
  contractType: "Full time",
  salaryMinUsd: 3000,
  salaryMaxUsd: 4000,
  salaryPeriod: "mensual",
  salaryNote: null,
  weeklyHours: null,
  candidatesCount: 12,
  badges: [],
  jdText: `Buscamos AI Engineer con RAG y agentes (${externalId}). Remoto para Argentina y Chile.`,
  postedAt: new Date(),
  tags: ["Python"],
  seniority: "Senior",
  lang: "es",
});

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
  match_fuerte: ["RAG"],
  gaps: [],
  riesgos: [],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "Match alto.",
  accion_sugerida: "aplicar",
};

async function seedUser(userId: string, tag: string) {
  await conn.db
    .insert(s.profiles)
    .values({
      userId,
      displayName: `Persona ${tag}`,
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: `u_${tag}@ingest.test`,
      profileSummary: "AI Engineer con RAG y agentes.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}

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
  await seedUser(A, "a");
  await seedUser(B, "b");
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("dueño de la cola vs dueño del job (H-4)", () => {
  it("un mensaje de B con el job de A no llama al LLM ni gasta cupo, y queda fallido", async () => {
    const q = createPgQueue(conn.db);
    // Job de A ingerido sin encolar: el único mensaje de la cola es el cruzado
    const out = await ingestRawJob(raw("om-a1"), {
      db: conn.db,
      userId: A,
      rules: criteria as never,
      logger,
      enqueueEvaluation: async () => {},
    });
    expect(out.action).toBe("inserted");
    const jobA = out.jobId;
    await q.enqueue(EVALUATE_QUEUE, { jobId: jobA }, { userId: B });

    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 10, dailyCapUsd: 0, userDailyCapUsd: 0 },
    );

    expect(llm.calls).toHaveLength(0);
    expect(summary).toMatchObject({ taken: 1, evaluated: 0, failed: 1 });
    const rows = await conn.db.select().from(s.jobQueue);
    const row = rows.find((r) => (r.payload as { jobId?: string }).jobId === jobA);
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toContain("no coincide");
    expect(await conn.db.select().from(s.llmCalls)).toHaveLength(0);
    expect(await conn.db.select().from(s.evaluations).where(eq(s.evaluations.jobId, jobA))).toEqual(
      [],
    );
    const [job] = await conn.db
      .select({ status: s.jobs.status })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobA));
    expect(job?.status).not.toBe("evaluated");
  });
});
