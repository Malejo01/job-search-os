import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { JD_HARD_MAX_CHARS, PROMPT_MAX_CHARS, type RawJob } from "@job-search-os/pipeline";
import { and, eq, isNull } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachJdText } from "../ingest/attach-jd";
import { ingestRawJob } from "../ingest/ingest-job";
import { createFakeLlm } from "../llm/fake";
import { createPgQueue } from "../queue/pg-queue";
import { evaluateJobById } from "./evaluate-job";

/**
 * Una JD fuera del máximo duro deja la oferta en la cola de pendientes y acepta una JD nueva; un
 * prompt que se pasa del máximo no llega al modelo. Cliente LLM falso. Datos inventados.
 */
const USER = "a3300000-0000-4000-8000-000000000001";
const USER_BIG_PROFILE = "a3300000-0000-4000-8000-000000000002";

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
  match_fuerte: ["RAG"],
  gaps: [],
  riesgos: [],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "Match alto.",
  accion_sugerida: "aplicar",
};

const raw = (externalId: string, over: Partial<RawJob> = {}): RawJob => ({
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
  ...over,
});

const padded = (head: string, length: number, seed: string) => {
  const words = Array.from({ length: Math.ceil(length / 3) }, (_, i) => `${seed}${i.toString(36)}`);
  return `${head} ${words.join(" ")}`.slice(0, length - 1) + ".";
};

const ingest = (job: RawJob, userId = USER) =>
  ingestRawJob(job, { db: conn.db, userId, rules: criteria as never, logger });
const evalDeps = (llm: ReturnType<typeof createFakeLlm>) => ({
  db: conn.db,
  llm,
  queue: createPgQueue(conn.db),
  logger,
});
/** Deja en la base una JD de un carácter más que el máximo duro, sin pasar por la ingesta (que la recorta). */
const hugeJd = (jobId: string, seed: string) =>
  conn.db
    .update(s.jobs)
    .set({ jdText: padded("Buscamos AI Engineer.", JD_HARD_MAX_CHARS + 1, seed) })
    .where(eq(s.jobs.id, jobId));
const jobRow = async (id: string) =>
  (await conn.db.select().from(s.jobs).where(eq(s.jobs.id, id)).limit(1))[0]!;

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
  for (const [userId, tag, summary] of [
    [USER, "a33", "AI Engineer con RAG y agentes."],
    [USER_BIG_PROFILE, "b33", "AI Engineer. ".repeat(PROMPT_MAX_CHARS / 10)],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: "Persona A",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: `u_${tag}@ingest.test`,
        profileSummary: summary,
      })
      .onConflictDoNothing();
    await conn.db
      .insert(s.evaluationCriteria)
      .values({ userId, version: 1, active: true, rules: criteria as never })
      .onConflictDoNothing();
  }
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("JD fuera del máximo duro: la oferta vuelve a la cola y acepta una JD nueva", () => {
  it("una oferta prefiltrada con 300.001 caracteres queda sin jd_text y en pendiente_jd", async () => {
    // La ingesta ya recorta la JD al máximo duro: el dato viejo (una JD enorme ya guardada) se arma directo
    // en la base, que es el caso que la defensa del worker sigue cubriendo
    const out = await ingest(raw("larga-1"));
    await hugeJd(out.jobId, "a");
    expect((await jobRow(out.jobId)).status).toBe("prefiltrada");

    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const result = await evaluateJobById(out.jobId, evalDeps(llm));
    expect(llm.calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, retry: "skipped" });

    const row = await jobRow(out.jobId);
    expect(row.status).toBe("pendiente_jd");
    expect(row.jdText).toBeNull();
    expect(row.jdHash).toBeNull();
    expect(row.prefilterReason).toMatch(/demasiado larga/);

    // La misma condición con la que la cola de pendientes elige las ofertas
    const inQueue = await conn.db
      .select({ id: s.jobs.id })
      .from(s.jobs)
      .where(
        and(eq(s.jobs.id, out.jobId), eq(s.jobs.status, "pendiente_jd"), isNull(s.jobs.jdText)),
      );
    expect(inQueue).toHaveLength(1);
  });

  it("acepta una JD nueva con onlyPending (lo que usa paste_jd)", async () => {
    const out = await ingest(
      raw("larga-2", { title: "Applied AI Platform Developer", companyRaw: "Consultora Beta" }),
    );
    await hugeJd(out.jobId, "b");
    await evaluateJobById(out.jobId, evalDeps(createFakeLlm({ evaluate_job: fakeEvaluation })));
    expect((await jobRow(out.jobId)).status).toBe("pendiente_jd");

    const nueva = `Buscamos una persona AI Engineer para un equipo de plataforma. ${"Trabajo remoto, RAG y agentes. ".repeat(10)}`;
    await attachJdText(conn.db, {
      userId: USER,
      jobId: out.jobId,
      text: nueva,
      taxonomy: [],
      onlyPending: true,
    });
    expect((await jobRow(out.jobId)).jdText).toBe(nueva.trim());
  });
});

describe("prompt completo fuera del máximo", () => {
  it("no llama al modelo y no cambia el estado de la oferta", async () => {
    const out = await ingest(raw("prompt-1", { companyRaw: "Empresa Prompt" }), USER_BIG_PROFILE);
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const result = await evaluateJobById(out.jobId, evalDeps(llm));

    expect(llm.calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, retry: "skipped" });
    expect((result as { error: string }).error).toMatch(/prompt demasiado largo/);
    const row = await jobRow(out.jobId);
    expect(row.status).toBe("prefiltrada");
    expect(row.jdText).not.toBeNull();
  });
});
