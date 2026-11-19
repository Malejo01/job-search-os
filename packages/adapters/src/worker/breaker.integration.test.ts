import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import type { RawJob } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeLlm } from "../llm/fake";
import { ingestRawJob } from "../ingest/ingest-job";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { runEvaluateWorker } from "./evaluate-job";

/** Corte de circuito del worker: tras N fallas seguidas del proveedor la corrida termina. */
const USER = "c6000000-0000-4000-8000-000000000001";
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

async function enqueueJobs(prefix: string, n: number) {
  const q = createPgQueue(conn.db);
  for (let i = 0; i < n; i++) {
    const out = await ingestRawJob(raw(`${prefix}-${i}`), {
      db: conn.db,
      userId: USER,
      rules: criteria as never,
      logger,
      enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
    });
    expect(out.action).toBe("inserted");
  }
  return q;
}

const queueCount = async (status: string) =>
  (await conn.db.select().from(s.jobQueue)).filter(
    (r) => r.queue === EVALUATE_QUEUE && r.status === status,
  ).length;

const failingLlm = () =>
  createFakeLlm(
    {},
    { failWith: { kind: "generation_failed", task: "evaluate_job", detail: "api_call:401" } },
  );

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
      inboundAddress: "u_breaker@ingest.test",
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

describe("corte de circuito del worker", () => {
  it("con N fallas seguidas corta y los mensajes no procesados siguen en la cola", async () => {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
    const q = await enqueueJobs("brk-a", 8);
    const llm = failingLlm();

    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 20, dailyCapUsd: 0, userDailyCapUsd: 0, maxConsecutiveFailures: 3 },
    );

    expect(summary.stopped).toBe("breaker");
    expect(llm.calls).toHaveLength(3);
    expect(summary.retried).toBe(3);
    expect(summary.taken).toBe(3);
    // los 5 no procesados vuelven a pending sin gastar intento ni quedar bloqueados
    const rows = (await conn.db.select().from(s.jobQueue)).filter(
      (r) => r.queue === EVALUATE_QUEUE,
    );
    expect(await queueCount("processing")).toBe(0);
    expect(rows.filter((r) => r.status === "pending" && r.attempts === 0)).toHaveLength(5);
  });

  it("sin llegar a N fallas seguidas no corta", async () => {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
    const q = await enqueueJobs("brk-b", 4);
    const summary = await runEvaluateWorker(
      { db: conn.db, llm: failingLlm(), queue: q, logger },
      { limit: 20, dailyCapUsd: 0, userDailyCapUsd: 0, maxConsecutiveFailures: 5 },
    );
    expect(summary.stopped).toBeNull();
    expect(summary.retried).toBe(4);
  });
});
