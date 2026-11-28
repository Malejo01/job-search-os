import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { jobCardHash, type RawJob } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import { drizzleCallSink } from "../llm/calls";
import { createDemoLlm } from "../llm/demo";
import { createPgQueue, enqueueEvaluationWith } from "../queue/pg-queue";
import { evaluateJobById } from "../worker/evaluate-job";

/**
 * R31-03 · «Siempre antes de evaluar»: `evaluateJobById` deja la ficha del aviso lista antes de evaluar solo
 * con `JOB_CARD` encendida; apagada, la evaluación corre exactamente como antes (sin ficha, sin gasto).
 * Modelo simulado, base real, aviso inventado.
 */
const USER = "a3100000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const JD = `Empresa A busca AI Engineer con experiencia en RAG, agentes y MCP. Python y TypeScript. Remoto para Argentina y Chile.

Qué vas a hacer
- Diseñar agentes y flujos de recuperación de información con RAG.
- Conectar herramientas por MCP.

Requisitos indispensables:
- Manejo de Python.
Deseable:
- Experiencia con TypeScript.

Condiciones
Modalidad remota para personas de Argentina y Chile.
Jornada completa.`;

const raw = (externalId: string, jdText: string, title = "Atención al cliente"): RawJob => ({
  source: {
    kind: "getonboard_api",
    name: "GoB programming",
    externalId,
    url: `https://www.getonbrd.com/jobs/${externalId}`,
    rawRef: null,
  },
  title,
  companyRaw: "Empresa A",
  locationRaw: "Remoto (Argentina)",
  countriesAllowed: ["AR"],
  modality: "remoto",
  contractType: "Full time",
  salaryMinUsd: null,
  salaryMaxUsd: null,
  salaryPeriod: null,
  salaryNote: null,
  weeklyHours: null,
  candidatesCount: null,
  badges: [],
  jdText,
  postedAt: new Date(),
  tags: [],
  seniority: null,
  lang: "es",
});

async function ingest(externalId: string, jd = JD, title?: string): Promise<string> {
  const q = createPgQueue(conn.db);
  const out = await ingestRawJob(raw(externalId, jd, title), {
    db: conn.db,
    userId: USER,
    rules: criteria as never,
    logger,
    enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
  });
  if (out.action !== "inserted") throw new Error(`no se insertó: ${out.action}`);
  return out.jobId;
}

const evaluate = (jobId: string) =>
  evaluateJobById(jobId, {
    db: conn.db,
    llm: createDemoLlm({ calls: drizzleCallSink(conn.db) }),
    queue: createPgQueue(conn.db),
    logger,
  });

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
      displayName: "Prueba",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_hook@ingest.test",
      profileSummary: "Atención al cliente.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("evaluateJobById y la ficha del aviso", () => {
  it("con JOB_CARD apagada evalúa como siempre: no hay ficha ni llamada de ficha", async () => {
    vi.stubEnv("JOB_CARD", "");
    const jobId = await ingest("hook-off", JD, "AI Engineer");
    const out = await evaluate(jobId);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const cards = await conn.db
      .select()
      .from(s.jobCards)
      .where(eq(s.jobCards.jdHash, jobCardHash(JD)));
    expect(cards).toEqual([]);
    const calls = await conn.db
      .select()
      .from(s.llmCalls)
      .where(eq(s.llmCalls.task, "extract_job_card"));
    expect(calls).toEqual([]);
  });

  it("con JOB_CARD encendida deja la ficha lista antes de evaluar, y evalúa", async () => {
    vi.stubEnv("JOB_CARD", "testers");
    // La cuenta de la oferta está en la etapa (admin): con `testers`, el worker solo genera para esas cuentas
    vi.stubEnv("ADMIN_EMAILS", "hook-admin@example.com");
    await conn.db
      .insert(s.users)
      .values({ id: USER, email: "hook-admin@example.com" })
      .onConflictDoNothing();
    const jd = `Empresa B busca Agent Engineer para construir evaluaciones de agentes con TypeScript y Node. Remoto para Argentina.

Qué vas a hacer
- Escribir evals automáticas para agentes de soporte.
- Medir la calidad de cada versión del agente.

Requisitos indispensables:
- Manejo de TypeScript.
Deseable:
- Experiencia con Docker.

Condiciones
Modalidad remota para personas de Argentina.
Jornada completa.`;
    const jobId = await ingest("hook-on", jd, "Agent Engineer");
    const out = await evaluate(jobId);
    expect(out).toMatchObject({ ok: true });
    const [card] = await conn.db
      .select()
      .from(s.jobCards)
      .where(eq(s.jobCards.jdHash, jobCardHash(jd)));
    expect(card).toMatchObject({ status: "lista", model: "fake", modality: "remoto" });
    // Reevaluar el mismo aviso no genera otra ficha
    const before = await conn.db
      .select()
      .from(s.llmCalls)
      .where(eq(s.llmCalls.task, "extract_job_card"));
    await evaluate(jobId).catch(() => undefined);
    const after = await conn.db
      .select()
      .from(s.llmCalls)
      .where(eq(s.llmCalls.task, "extract_job_card"));
    expect(after.length).toBe(before.length);
  });
});
