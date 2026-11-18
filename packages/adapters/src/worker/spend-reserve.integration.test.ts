import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import type { RawJob } from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import { createFakeLlm } from "../llm/fake";
import { spendLast24h, LLM_RESERVE_TASK } from "../llm/spend";
import { LLM_RESERVE_TTL_MS, releaseLlmSpend, reserveLlmSpend } from "../llm/spend-reserve";
import type { LlmClient } from "../llm/types";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { evaluateJobNow } from "./evaluate-job";

/**
 * Reserva de gasto antes de llamar al modelo: los pedidos en paralelo ven lo que los otros ya reservaron.
 * Cliente falso que anota un costo real, como hace el cliente LLM: cero llamadas pagas. Datos inventados.
 */
const A = "a3100000-0000-4000-8000-000000000001";
const B = "b3100000-0000-4000-8000-000000000002";
const CALL_USD = 0.06;
const CAP_USD = 0.1;

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

/** Tarda un poco y deja la fila con costo real antes de volver, igual que el cliente LLM. */
function payingLlm(): LlmClient & { calls: unknown[] } {
  const fake = createFakeLlm({ evaluate_job: fakeEvaluation });
  return {
    calls: fake.calls,
    async generateStructured(task, schema, vars, ctx) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await conn.db.insert(s.llmCalls).values({
        userId: ctx?.userId ?? null,
        task,
        model: "modelo-falso",
        costUsd: CALL_USD,
        ok: true,
      });
      return fake.generateStructured(task, schema, vars, ctx);
    },
  };
}

async function seedUser(userId: string, tag: string) {
  await conn.db
    .insert(s.profiles)
    .values({
      userId,
      displayName: `Persona ${tag}`,
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: `u_${tag}r@ingest.test`,
      profileSummary: "AI Engineer con RAG y agentes.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}

async function enqueueJobs(userId: string, prefix: string, count: number): Promise<string[]> {
  const q = createPgQueue(conn.db);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const out = await ingestRawJob(raw(`${prefix}-${i}`), {
      db: conn.db,
      userId,
      rules: criteria as never,
      logger,
      enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
    });
    expect(out.action).toBe("inserted");
    ids.push(out.jobId);
  }
  return ids;
}

const liveReservations = async () =>
  conn.db.select().from(s.llmCalls).where(eq(s.llmCalls.task, LLM_RESERVE_TASK));

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
  conn = createDb(ownerUrl, { max: 10 });
  await seedUser(A, "a31");
  await seedUser(B, "b31");
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls);
  await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
});

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("evaluateJobNow con reserva de gasto", () => {
  it("20 evaluaciones en paralelo: el gasto de la persona no pasa del tope más una llamada", async () => {
    const jobs = await enqueueJobs(A, "paralelo-a", 20);
    const llm = payingLlm();
    const deps = { db: conn.db, llm, queue: createPgQueue(conn.db), logger };

    const results = await Promise.all(
      jobs.map((id) => evaluateJobNow(id, deps, { dailyCapUsd: 0, userDailyCapUsd: CAP_USD })),
    );

    const spent = await spendLast24h(conn.db, undefined, { userId: A });
    expect(llm.calls.length).toBeGreaterThan(0);
    expect(spent.usd).toBeLessThanOrEqual(CAP_USD + CALL_USD + 1e-9);
    expect(results.filter((r) => !r.ran && r.reason === "user_cap").length).toBeGreaterThan(0);
    expect(await liveReservations()).toHaveLength(0);
  });

  it("con dos personas en paralelo, el gasto total no pasa del tope global más una llamada", async () => {
    const jobsA = await enqueueJobs(A, "global-a", 10);
    const jobsB = await enqueueJobs(B, "global-b", 10);
    const llm = payingLlm();
    const deps = { db: conn.db, llm, queue: createPgQueue(conn.db), logger };

    await Promise.all(
      [...jobsA, ...jobsB].map((id) =>
        evaluateJobNow(id, deps, { dailyCapUsd: CAP_USD, userDailyCapUsd: 0 }),
      ),
    );

    expect((await spendLast24h(conn.db)).usd).toBeLessThanOrEqual(CAP_USD + CALL_USD + 1e-9);
  });

  it("si el modelo falla, la reserva se suelta y no queda contando", async () => {
    const [jobId] = await enqueueJobs(A, "falla-a", 1);
    const down = createFakeLlm(
      {},
      { failWith: { kind: "generation_failed", task: "evaluate_job", detail: "503" } },
    );

    await evaluateJobNow(
      jobId!,
      { db: conn.db, llm: down, queue: createPgQueue(conn.db), logger },
      { dailyCapUsd: 0, userDailyCapUsd: CAP_USD },
    );

    expect(await liveReservations()).toHaveLength(0);
  });
});

describe("reserveLlmSpend", () => {
  const caps = { dailyCapUsd: 0, userDailyCapUsd: CAP_USD };

  it("20 reservas en paralelo: pasan solo las que entran en el tope", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserveLlmSpend(conn.db, { userId: A, estimateUsd: 0.03, ...caps }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(results.filter((r) => !r.ok && r.reason === "user")).toHaveLength(16);
  });

  it("el tope de una persona no frena a otra", async () => {
    await reserveLlmSpend(conn.db, { userId: A, estimateUsd: CAP_USD, ...caps });

    expect(await reserveLlmSpend(conn.db, { userId: A, estimateUsd: 0.01, ...caps })).toEqual({
      ok: false,
      reason: "user",
    });
    expect((await reserveLlmSpend(conn.db, { userId: B, estimateUsd: 0.01, ...caps })).ok).toBe(
      true,
    );
  });

  it("soltar la reserva libera el cupo, y soltarla dos veces no hace nada", async () => {
    const first = await reserveLlmSpend(conn.db, { userId: A, estimateUsd: CAP_USD, ...caps });
    if (!first.ok) throw new Error("la primera reserva tenía que pasar");

    expect(await releaseLlmSpend(conn.db, first.reservationId)).toBe(true);
    expect(await releaseLlmSpend(conn.db, first.reservationId)).toBe(true);

    expect((await reserveLlmSpend(conn.db, { userId: A, estimateUsd: 0.01, ...caps })).ok).toBe(
      true,
    );
  });

  it("una reserva vencida deja de contar", async () => {
    await reserveLlmSpend(conn.db, { userId: A, estimateUsd: CAP_USD, ...caps });
    const expired = new Date(Date.now() - LLM_RESERVE_TTL_MS - 1000);
    await conn.db
      .update(s.llmCalls)
      .set({ createdAt: expired })
      .where(eq(s.llmCalls.task, LLM_RESERVE_TASK));

    expect((await reserveLlmSpend(conn.db, { userId: A, estimateUsd: 0.01, ...caps })).ok).toBe(
      true,
    );
  });

  it("la reserva no suma como gasto ni como llamada en los reportes", async () => {
    await reserveLlmSpend(conn.db, { userId: A, estimateUsd: 0.05, ...caps });

    expect(await spendLast24h(conn.db)).toMatchObject({ usd: 0, calls: 0 });
    const [row] = await conn.db
      .select({ usd: sql<number>`coalesce(sum(${s.llmCalls.costUsd}), 0)::float8` })
      .from(s.llmCalls);
    expect(row?.usd).toBe(0);
  });

  it("con los topes en 0 no frena", async () => {
    const off = { dailyCapUsd: 0, userDailyCapUsd: 0 };
    await reserveLlmSpend(conn.db, { userId: A, estimateUsd: 100, ...off });

    expect((await reserveLlmSpend(conn.db, { userId: A, estimateUsd: 100, ...off })).ok).toBe(true);
  });
});
