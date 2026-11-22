import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import {
  JD_HARD_MAX_CHARS,
  JD_PROMPT_MAX_CHARS,
  JOB_CLOSE,
  type RawJob,
} from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import { createFakeLlm } from "../llm/fake";
import { createPgQueue } from "../queue/pg-queue";
import { pgBlobStorage } from "../storage/blob";
import { evaluateJobById } from "./evaluate-job";

/**
 * Tamaño de los textos de una oferta: la JD enorme no llega al modelo y los campos cortos se
 * recortan al ingresar. Cliente LLM falso: cero llamadas pagas. Datos inventados.
 */
const USER = "a3200000-0000-4000-8000-000000000001";
const JD_MARK = "Descripción del puesto:\n";

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

/** Texto de largo exacto con palabras propias de cada caso, para que dos avisos no se fusionen. */
const padded = (head: string, length: number, seed: string) => {
  const words = Array.from({ length: Math.ceil(length / 3) }, (_, i) => `${seed}${i.toString(36)}`);
  return `${head} ${words.join(" ")}`.slice(0, length - 1) + ".";
};

const ingest = (job: RawJob) =>
  ingestRawJob(job, { db: conn.db, userId: USER, rules: criteria as never, logger });

const evalDeps = (llm: ReturnType<typeof createFakeLlm>) => ({
  db: conn.db,
  llm,
  queue: createPgQueue(conn.db),
  logger,
});

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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Persona A",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_a32@ingest.test",
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

describe("JD fuera del máximo duro", () => {
  it("no llama al modelo: la oferta queda pendiente de JD con el motivo", async () => {
    // La ingesta ya recorta la JD al máximo duro: el dato viejo (una JD enorme ya guardada) se arma directo
    // en la base, que es el caso que la defensa del worker sigue cubriendo
    const out = await ingest(raw("tam-dura-1"));
    expect(out.action).toBe("inserted");
    await conn.db
      .update(s.jobs)
      .set({ jdText: padded("Buscamos AI Engineer.", JD_HARD_MAX_CHARS + 1, "a") })
      .where(eq(s.jobs.id, out.jobId));
    expect((await jobRow(out.jobId)).status).toBe("prefiltrada");

    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const result = await evaluateJobById(out.jobId, evalDeps(llm));

    expect(llm.calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, retry: "skipped" });
    const row = await jobRow(out.jobId);
    expect(row.status).toBe("pendiente_jd");
    expect(row.prefilterReason).toMatch(/demasiado larga/);
  });
});

describe("JD larga pero dentro del máximo duro", () => {
  it("se evalúa y el modelo recibe como mucho 60.000 caracteres de JD", async () => {
    const out = await ingest(
      raw("tam-prompt-1", {
        // Otra empresa y otro título: si no, se fusiona con la oferta del caso anterior
        title: "Applied AI Platform Developer",
        companyRaw: "Consultora Beta",
        jdText: padded("Buscamos AI Engineer.", JD_PROMPT_MAX_CHARS + 1_000, "b"),
      }),
    );
    expect(out.action).toBe("inserted");

    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const result = await evaluateJobById(out.jobId, evalDeps(llm));

    expect(result.ok).toBe(true);
    expect(llm.calls).toHaveLength(1);
    const job = String(llm.calls[0]!.vars.job);
    const afterMark = job.split(JD_MARK)[1] ?? "";
    const jdSent = afterMark.endsWith(JOB_CLOSE)
      ? afterMark.slice(0, -JOB_CLOSE.length)
      : afterMark;
    expect(jdSent.length).toBeGreaterThan(0);
    expect(jdSent.length).toBeLessThanOrEqual(JD_PROMPT_MAX_CHARS + 1);
  });
});

describe("ingestRawJob: título de 1 MB", () => {
  it("guarda 300 caracteres en jobs.title y el crudo conserva el original", async () => {
    const longTitle = "t".repeat(1_000_000);
    const original = JSON.stringify({ title: longTitle });
    const job = raw("tam-titulo-1", {
      title: longTitle,
      source: {
        kind: "getonboard_api",
        name: "Fuente A",
        externalId: "tam-titulo-1",
        url: "https://example.test/jobs/tam-titulo-1",
        rawRef: null,
        original: { contentType: "application/json", body: original },
      },
    });

    const out = await ingest(job);

    expect(out.action).toBe("inserted");
    expect((await jobRow(out.jobId)).title).toHaveLength(300);
    const [src] = await conn.db
      .select()
      .from(s.jobSources)
      .where(eq(s.jobSources.jobId, out.jobId));
    const blob = await pgBlobStorage(conn.db).get(src!.rawRef!);
    expect(JSON.parse(blob!.body).title).toHaveLength(1_000_000);
  });
});
