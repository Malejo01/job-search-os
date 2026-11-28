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
 * El aviso que pega el spec e2e 02 («pegar JD → evaluación al instante») evaluado con `JOB_CARD=testers`, la
 * cuenta como admin y la ficha generada por el modelo simulado, como en el CI y en local. Si algo revienta
 * después de la respuesta del modelo, `evaluateJobById` lanza y el test muestra el stack completo (en el
 * servidor solo queda la clase del error). Datos inventados.
 */
const USER = "a3100000-0000-4000-8000-0000000000e2";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const JD = `Buscamos AI Engineer para construir agentes con RAG sobre documentos legales. Responsabilidades: diseñar pipelines de ingesta y embeddings, integrar LLMs vía API (OpenAI, Gemini), evaluar calidad con datasets propios, exponer servicios en Python (FastAPI) y TypeScript. Requisitos: 3+ años en backend, experiencia con vector DBs, prompt engineering y observabilidad de LLM. Deseable: AWS. Remoto para Argentina, contrato full time, salario en USD.`;

const raw = (externalId: string, jdText: string): RawJob => ({
  source: {
    kind: "getonboard_api",
    name: "GoB programming",
    externalId,
    url: `https://www.getonbrd.com/jobs/${externalId}`,
    rawRef: null,
  },
  title: "AI Engineer",
  companyRaw: "Empresa A",
  locationRaw: "Remoto (Argentina)",
  // Como el job de los e2e (pegado a mano): sin lista de países
  countriesAllowed: null,
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
    .values({ id: USER, email: "jd-admin@example.com" })
    .onConflictDoNothing();
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Prueba",
      locationCountry: "AR",
      remoteOnly: true,
      // Como la persona de los e2e: años y nivel de inglés cargados
      yearsTotal: 5,
      englishCefr: "C1",
      inboundAddress: "u_jd02@ingest.test",
      profileSummary: "Desarrollo de software.",
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

describe("el aviso del spec 02 con la ficha encendida", () => {
  it("se evalúa sin errores (si falla, el test muestra el stack)", async () => {
    vi.stubEnv("JOB_CARD", "testers");
    vi.stubEnv("ADMIN_EMAILS", "jd-admin@example.com");
    const q = createPgQueue(conn.db);
    const out = await ingestRawJob(raw("jd02", JD), {
      db: conn.db,
      userId: USER,
      rules: criteria as never,
      logger,
      enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
    });
    if (out.action !== "inserted") throw new Error(`no se insertó: ${out.action}`);
    // lanza el error original (con stack) en vez de devolver solo su clase
    const res = await evaluateJobById(out.jobId, {
      db: conn.db,
      llm: createDemoLlm({ calls: drizzleCallSink(conn.db) }),
      queue: q,
      logger,
    });
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    const [card] = await conn.db
      .select()
      .from(s.jobCards)
      .where(eq(s.jobCards.jdHash, jobCardHash(JD)));
    expect(card?.status).toBe("lista");
  });
});
