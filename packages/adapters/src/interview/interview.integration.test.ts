import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s, type Db } from "@job-search-os/db";
import { err, INTERVIEW_MAX_SIMULATIONS_PER_DAY } from "@job-search-os/pipeline";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzleCallSink } from "../llm/calls";
import { createDemoLlm } from "../llm/demo";
import { LLM_RESERVE_TASK } from "../llm/spend";
import { LLM_RESERVE_TTL_MS } from "../llm/spend-reserve";
import type { LlmClient } from "../llm/types";
import { INTERVIEW_START_LABEL_PREFIX } from "./reserve";
import { answerInterview, startInterview, type InterviewDeps } from "./service";
import { loadInterviewSession } from "./store";

/**
 * Simulador contra la base: tope de 2 simulaciones por día (también en paralelo), reservas que se sueltan en
 * `finally` y vencen, topes globales y por persona, y el recorrido completo con el modelo simulado. Sin gasto.
 * Datos inventados.
 */
const USERS = Array.from({ length: 3 }, (_, i) => `a3180000-0000-4000-8000-00000000000${i + 1}`);
const [A, B] = USERS as [string, string, string];
const NOW = new Date();
const GOOD_ANSWER =
  "Cuando el cierre tardaba dos días en mi proyecto, armé un tablero y logré bajarlo a una hora, un 80% menos.";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let jobA: string;
let jobB: string;

const failingLlm: LlmClient = {
  async generateStructured(task) {
    return err({ kind: "generation_failed", task, detail: "falla simulada" });
  },
};

function makeDeps(
  overrides: Partial<InterviewDeps> = {},
): InterviewDeps & { llmCalls: () => number } {
  let calls = 0;
  const demo = createDemoLlm({ calls: drizzleCallSink(conn.db) });
  const llm: LlmClient = {
    async generateStructured(...args) {
      calls++;
      return demo.generateStructured(...args);
    },
  };
  const withUser = <T>(_userId: string, fn: (db: Db) => Promise<T>): Promise<T> => fn(conn.db);
  return {
    llm,
    reserveDb: conn.db,
    withUser,
    caps: { dailyCapUsd: 0, userDailyCapUsd: 0 },
    ...overrides,
    llmCalls: () => calls,
  };
}

const career = { kind: "career", career: "Analista de datos", seniority: "junior" } as const;

async function liveReservations(userId: string): Promise<number> {
  const rows = await conn.db
    .select({ id: s.llmCalls.id })
    .from(s.llmCalls)
    .where(and(eq(s.llmCalls.userId, userId), eq(s.llmCalls.task, LLM_RESERVE_TASK)));
  return rows.length;
}

async function sessionsOf(userId: string): Promise<number> {
  return (
    await conn.db.select().from(s.interviewSessions).where(eq(s.interviewSessions.userId, userId))
  ).length;
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
  conn = createDb(ownerUrl, { max: 8 });
  await conn.db
    .insert(s.users)
    .values(USERS.map((id, i) => ({ id, email: `entrevista-${i}@example.com` })))
    .onConflictDoNothing();
  const [ja] = await conn.db
    .insert(s.jobs)
    .values({
      userId: A,
      companyRaw: "Empresa A",
      title: "Analista de datos",
      titleNormalized: "analista datos",
      jdText: "SQL y Excel.",
    })
    .returning({ id: s.jobs.id });
  const [jb] = await conn.db
    .insert(s.jobs)
    .values({ userId: B, companyRaw: "Empresa B", title: "Analista", titleNormalized: "analista" })
    .returning({ id: s.jobs.id });
  jobA = ja!.id;
  jobB = jb!.id;
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.interviewSessions).where(inArray(s.interviewSessions.userId, USERS));
  await conn.db.delete(s.llmCalls).where(inArray(s.llmCalls.userId, USERS));
});

afterAll(async () => {
  await conn?.db.delete(s.interviewSessions).where(inArray(s.interviewSessions.userId, USERS));
  await conn?.db.delete(s.llmCalls).where(inArray(s.llmCalls.userId, USERS));
  await conn?.db.delete(s.jobs).where(inArray(s.jobs.userId, USERS));
  await conn?.db.delete(s.users).where(inArray(s.users.id, USERS));
  await conn?.close();
  await container?.stop();
});

describe("startInterview · tope de simulaciones por día", () => {
  it("deja empezar dos y frena la tercera", async () => {
    expect(INTERVIEW_MAX_SIMULATIONS_PER_DAY).toBe(2);
    const deps = makeDeps();
    expect((await startInterview(deps, { userId: A, source: career })).ok).toBe(true);
    expect(
      (await startInterview(deps, { userId: A, source: { kind: "job", jobId: jobA } })).ok,
    ).toBe(true);
    const third = await startInterview(deps, { userId: A, source: career });
    expect(third).toEqual({ ok: false, error: "daily_limit" });
    expect(await sessionsOf(A)).toBe(2);
  });

  it("con pedidos en paralelo de la misma persona entran solo dos", async () => {
    const deps = makeDeps();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => startInterview(deps, { userId: A, source: career })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.error === "daily_limit")).toHaveLength(4);
    expect(await sessionsOf(A)).toBe(2);
    expect(await liveReservations(A)).toBe(0);
  });

  it("el tope es por persona", async () => {
    const deps = makeDeps();
    await startInterview(deps, { userId: A, source: career });
    await startInterview(deps, { userId: A, source: career });
    expect((await startInterview(deps, { userId: B, source: career })).ok).toBe(true);
  });

  it("una simulación de hace más de un día no cuenta", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (let i = 0; i < 2; i++) {
      await conn.db.insert(s.interviewSessions).values({
        userId: A,
        sourceKind: "career",
        career: "Analista",
        seniority: "junior",
        title: "Vieja",
        questions: ["a", "b", "c", "d", "e"],
        createdAt: old,
      });
    }
    expect((await startInterview(makeDeps(), { userId: A, source: career })).ok).toBe(true);
  });

  it("si el modelo falla no queda simulación, se suelta la reserva y no gasta cupo del día", async () => {
    const failing = makeDeps({ llm: failingLlm });
    for (let i = 0; i < 3; i++) {
      expect(await startInterview(failing, { userId: A, source: career })).toEqual({
        ok: false,
        error: "llm_failed",
      });
    }
    expect(await sessionsOf(A)).toBe(0);
    expect(await liveReservations(A)).toBe(0);
    expect((await startInterview(makeDeps(), { userId: A, source: career })).ok).toBe(true);
  });

  it("una oferta ajena o inexistente no se puede usar", async () => {
    const r = await startInterview(makeDeps(), { userId: A, source: { kind: "job", jobId: jobB } });
    expect(r).toEqual({ ok: false, error: "not_found" });
    expect(await sessionsOf(A)).toBe(0);
  });
});

describe("startInterview · reservas", () => {
  const orphan = (userId: string, ageMs: number) =>
    conn.db.insert(s.llmCalls).values({
      userId,
      task: LLM_RESERVE_TASK,
      model: "none",
      label: `${INTERVIEW_START_LABEL_PREFIX}a3180000-0000-4000-8000-0000000000ff`,
      tokensOut: 30_000,
      costUsd: null,
      ok: true,
      createdAt: new Date(NOW.getTime() - ageMs),
    });

  it("una reserva viva de otro pedido cuenta contra el tope diario", async () => {
    await orphan(A, 1_000);
    await conn.db.insert(s.llmCalls).values({
      userId: A,
      task: LLM_RESERVE_TASK,
      model: "none",
      label: `${INTERVIEW_START_LABEL_PREFIX}a3180000-0000-4000-8000-0000000000fe`,
      tokensOut: 30_000,
      costUsd: null,
      ok: true,
      createdAt: new Date(),
    });
    const r = await startInterview(makeDeps({ now: () => new Date() }), {
      userId: A,
      source: career,
    });
    expect(r).toEqual({ ok: false, error: "daily_limit" });
  });

  it("una reserva que quedó colgada deja de contar cuando vence", async () => {
    await orphan(A, LLM_RESERVE_TTL_MS + 60_000);
    await orphan(A, LLM_RESERVE_TTL_MS + 120_000);
    const r = await startInterview(makeDeps({ now: () => new Date() }), {
      userId: A,
      source: career,
    });
    expect(r.ok).toBe(true);
  });

  it("pasa por el tope global de gasto", async () => {
    await conn.db.insert(s.llmCalls).values({
      userId: B,
      task: "evaluate_job",
      model: "m",
      costUsd: 1,
      ok: true,
    });
    const r = await startInterview(makeDeps({ caps: { dailyCapUsd: 0.5, userDailyCapUsd: 0 } }), {
      userId: A,
      source: career,
    });
    expect(r).toEqual({ ok: false, error: "capped" });
    expect(await sessionsOf(A)).toBe(0);
  });

  it("pasa por el tope diario de la persona", async () => {
    await conn.db
      .insert(s.llmCalls)
      .values({ userId: A, task: "evaluate_job", model: "m", costUsd: 0.5, ok: true });
    const r = await startInterview(makeDeps({ caps: { dailyCapUsd: 0, userDailyCapUsd: 0.5 } }), {
      userId: A,
      source: career,
    });
    expect(r).toEqual({ ok: false, error: "capped" });
  });
});

describe("answerInterview", () => {
  async function started(deps = makeDeps()): Promise<string> {
    const r = await startInterview(deps, { userId: A, source: career });
    if (!r.ok) throw new Error("no arrancó");
    return r.value.sessionId;
  }

  it("recorre las cinco preguntas, guarda cada devolución y cierra la simulación", async () => {
    const deps = makeDeps();
    const sessionId = await started(deps);
    for (let i = 0; i < 5; i++) {
      const r = await answerInterview(deps, { userId: A, sessionId, answer: GOOD_ANSWER });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.position).toBe(i);
      expect(r.value.progress).toEqual({ current: Math.min(i + 2, 5), total: 5, done: i === 4 });
      expect(r.value.feedback.star).toBeGreaterThanOrEqual(0);
      expect(r.value.feedback.star).toBeLessThanOrEqual(10);
    }
    const loaded = await loadInterviewSession(conn.db, A, sessionId);
    expect(loaded?.answers).toHaveLength(5);
    expect(loaded?.session.status).toBe("terminada");
    expect(loaded?.session.finishedAt).not.toBeNull();
    expect(await answerInterview(deps, { userId: A, sessionId, answer: GOOD_ANSWER })).toEqual({
      ok: false,
      error: "finished",
    });
    expect(await liveReservations(A)).toBe(0);
  });

  it("una respuesta vacía o muy corta no llama al modelo", async () => {
    const deps = makeDeps();
    const sessionId = await started(deps);
    const before = deps.llmCalls();
    expect(await answerInterview(deps, { userId: A, sessionId, answer: "   " })).toEqual({
      ok: false,
      error: "empty",
    });
    expect(await answerInterview(deps, { userId: A, sessionId, answer: "no sé" })).toEqual({
      ok: false,
      error: "too_short",
    });
    expect(deps.llmCalls()).toBe(before);
  });

  it("si el modelo falla no guarda la respuesta y suelta la reserva", async () => {
    const sessionId = await started();
    const r = await answerInterview(makeDeps({ llm: failingLlm }), {
      userId: A,
      sessionId,
      answer: GOOD_ANSWER,
    });
    expect(r).toEqual({ ok: false, error: "llm_failed" });
    expect((await loadInterviewSession(conn.db, A, sessionId))?.answers).toHaveLength(0);
    expect(await liveReservations(A)).toBe(0);
  });

  it("dos envíos a la vez de la misma pregunta guardan una sola respuesta", async () => {
    const deps = makeDeps();
    const sessionId = await started(deps);
    const [x, y] = await Promise.all([
      answerInterview(deps, { userId: A, sessionId, answer: GOOD_ANSWER }),
      answerInterview(deps, { userId: A, sessionId, answer: GOOD_ANSWER }),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect((await loadInterviewSession(conn.db, A, sessionId))?.answers).toHaveLength(1);
    expect(await liveReservations(A)).toBe(0);
  });

  it("nadie responde en la simulación de otra persona", async () => {
    const sessionId = await started();
    const r = await answerInterview(makeDeps(), { userId: B, sessionId, answer: GOOD_ANSWER });
    expect(r).toEqual({ ok: false, error: "not_found" });
  });

  it("pasa por los topes de gasto", async () => {
    const sessionId = await started();
    await conn.db
      .insert(s.llmCalls)
      .values({ userId: A, task: "evaluate_job", model: "m", costUsd: 0.5, ok: true });
    const r = await answerInterview(makeDeps({ caps: { dailyCapUsd: 0, userDailyCapUsd: 0.5 } }), {
      userId: A,
      sessionId,
      answer: GOOD_ANSWER,
    });
    expect(r).toEqual({ ok: false, error: "capped" });
  });
});
