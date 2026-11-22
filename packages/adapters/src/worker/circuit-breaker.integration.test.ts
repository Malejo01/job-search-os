import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { err } from "@job-search-os/pipeline";
import type { RawJob } from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeLlm } from "../llm/fake";
import type { LlmClient } from "../llm/types";
import { ingestRawJob } from "../ingest/ingest-job";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { evaluateJobNow, evaluationCircuitOpen } from "./evaluate-job";

/**
 * Corte de circuito de la evaluación inmediata: con las últimas N llamadas de `evaluate_job`
 * fallidas en los últimos 10 minutos no se llama al modelo y la oferta queda para el cron.
 * Cliente falso, datos ficticios, cero llamadas pagas.
 */
const USER = "c5000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const MIN = 60_000;

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

async function enqueueJob(externalId: string) {
  const q = createPgQueue(conn.db);
  const out = await ingestRawJob(raw(externalId), {
    db: conn.db,
    userId: USER,
    rules: criteria as never,
    logger,
    enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
  });
  expect(out.action).toBe("inserted");
  return out.jobId;
}

const queueRow = async (jobId: string) =>
  (await conn.db.select().from(s.jobQueue)).find(
    (r) => (r.payload as { jobId?: string }).jobId === jobId,
  );

/** Filas de `evaluate_job` con antigüedad en minutos (0 = recién). */
async function seedCalls(rows: { ageMin: number; ok: boolean; error?: string | null }[]) {
  await conn.db.insert(s.llmCalls).values(
    rows.map((r) => ({
      userId: USER,
      task: "evaluate_job",
      model: "modelo-ficticio",
      ok: r.ok,
      costUsd: r.ok ? 0 : null,
      error: r.ok ? null : (r.error ?? "api_call:503"),
      createdAt: new Date(Date.now() - r.ageMin * MIN),
    })),
  );
}

const fails = (n: number, ageMin = 1) =>
  Array.from({ length: n }, (_, i) => ({ ageMin: ageMin + i * 0.1, ok: false }));

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
      inboundAddress: "u_cb@ingest.test",
      profileSummary: "AI Engineer con RAG y agentes.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls).where(eq(s.llmCalls.task, "evaluate_job"));
  await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
});

afterAll(async () => {
  await conn?.db.delete(s.llmCalls).where(eq(s.llmCalls.task, "evaluate_job"));
  await conn?.close();
  await container?.stop();
});

describe("corte de circuito de la evaluación inmediata", () => {
  it("5 fallas recientes seguidas: no llama al modelo y la oferta queda pendiente", async () => {
    const jobId = await enqueueJob("cb-1");
    await seedCalls(fails(5));
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const res = await evaluateJobNow(jobId, {
      db: conn.db,
      llm,
      queue: createPgQueue(conn.db),
      logger,
    });
    expect(res).toEqual({ ran: false, reason: "breaker" });
    expect(llm.calls).toHaveLength(0);
    expect((await queueRow(jobId))?.status).toBe("pending");
  });

  it("un éxito más nuevo que las fallas reabre el paso", async () => {
    const jobId = await enqueueJob("cb-2");
    await seedCalls([...fails(5, 2), { ageMin: 0.5, ok: true }]);
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const res = await evaluateJobNow(jobId, {
      db: conn.db,
      llm,
      queue: createPgQueue(conn.db),
      logger,
    });
    expect(res).toMatchObject({ ran: true });
    expect(llm.calls).toHaveLength(1);
  });

  it("menos de N fallas, fallas viejas o de contenido no cortan", async () => {
    const o = { db: conn.db } as const;
    await seedCalls(fails(4));
    expect(await evaluationCircuitOpen(o.db, { maxFailures: 5 })).toBe(false);
    await conn.db.delete(s.llmCalls);
    await seedCalls(fails(5, 11));
    expect(await evaluationCircuitOpen(o.db, { maxFailures: 5 })).toBe(false);
    await conn.db.delete(s.llmCalls);
    await seedCalls([...fails(4), { ageMin: 0.2, ok: false, error: "validation:invalid_type" }]);
    expect(await evaluationCircuitOpen(o.db, { maxFailures: 5 })).toBe(false);
    await conn.db.delete(s.llmCalls);
    await seedCalls(fails(5));
    expect(await evaluationCircuitOpen(o.db, { maxFailures: 5 })).toBe(true);
    expect(await evaluationCircuitOpen(o.db, { maxFailures: 6 })).toBe(false);
  });

  it("9 ofertas con el proveedor en 503: el lazo hace como mucho 5 llamadas", async () => {
    const jobs: string[] = [];
    for (let i = 0; i < 9; i++) jobs.push(await enqueueJob(`cb-loop-${i}`));
    let calls = 0;
    // Como el cliente real: cada intento fallido deja su fila en llm_calls
    const llm: LlmClient = {
      async generateStructured(task) {
        calls++;
        await seedCalls([{ ageMin: 0, ok: false, error: "api_call:503" }]);
        return err({ kind: "generation_failed", task, detail: "api_call:503" });
      },
    };
    const deps = { db: conn.db, llm, queue: createPgQueue(conn.db), logger };
    for (const jobId of jobs) {
      const r = await evaluateJobNow(jobId, deps);
      if (!r.ran && r.reason === "breaker") break;
    }
    expect(calls).toBeLessThanOrEqual(5);
    expect(calls).toBeGreaterThan(0);
  });

  it("el chequeo usa el índice con miles de filas: sin Seq Scan", async () => {
    const rows = Array.from({ length: 6000 }, (_, i) => ({
      userId: USER,
      task: i % 3 === 0 ? "evaluate_job" : "otra_tarea",
      model: "modelo-ficticio",
      ok: i % 7 !== 0,
      error: i % 7 !== 0 ? null : "api_call:503",
      createdAt: new Date(Date.now() - (i + 20) * MIN),
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await conn.db.insert(s.llmCalls).values(rows.slice(i, i + 1000));
    }
    await conn.db.execute(sql`analyze llm_calls`);
    const plan = await conn.db.execute(
      sql`explain select ok, error, created_at from llm_calls where task = 'evaluate_job' order by created_at desc limit 5`,
    );
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/Seq Scan/);
    expect(text).toMatch(/Index (Only )?Scan/);
  });
});
