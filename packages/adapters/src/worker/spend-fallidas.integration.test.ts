import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import type { RawJob } from "@job-search-os/pipeline";
import { err } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import type { LlmClient } from "../llm/types";
import { FAILED_CALL_ESTIMATE_USD } from "../llm/spend";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { runEvaluateWorker } from "./evaluate-job";

/**
 * El tope global de la corrida cuenta también el costo estimado de las llamadas fallidas
 * (sin uso informado), no solo el de las exitosas. Sin modelo real.
 */
const USER = "c5000000-0000-4000-8000-0000000000f4";
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

/** Cliente que deja la fila de falla sin costo (como un timeout) y devuelve el error. */
function timeoutLlm(): LlmClient & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async generateStructured(task) {
      state.calls++;
      await conn.db.insert(s.llmCalls).values({
        userId: USER,
        task,
        model: "fake-model",
        promptVersion: `${task}@v1`,
        latencyMs: 1,
        ok: false,
        error: "timeout",
      } as never);
      return err({ kind: "generation_failed", task, detail: "timeout" });
    },
  } as LlmClient & { calls: number };
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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Persona A",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_fallidas@ingest.test",
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

describe("gasto de llamadas fallidas en la corrida", () => {
  it("las fallas estimadas entran al acumulado y frenan la corrida por tope", async () => {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
    const q = createPgQueue(conn.db);
    for (let i = 0; i < 6; i++) {
      await ingestRawJob(raw(`fal-${i}`), {
        db: conn.db,
        userId: USER,
        rules: criteria as never,
        logger,
        enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
      });
    }
    const llm = timeoutLlm();
    // Tope para 2 fallas estimadas: tras la segunda la corrida tiene que cortar
    const cap = FAILED_CALL_ESTIMATE_USD * 2 - 0.001;
    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 20, dailyCapUsd: cap, userDailyCapUsd: 0, maxConsecutiveFailures: 100 },
    );
    expect(summary.stopped).toBe("cap");
    expect(llm.calls).toBe(2);
  });
});
