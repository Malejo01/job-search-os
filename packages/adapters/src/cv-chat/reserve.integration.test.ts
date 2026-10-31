import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import {
  cvChatCapReason,
  cvChatMonthTurnsReason,
  cvChatStartCapReason,
  CV_CHAT_MAX_COST_USD,
  type CvChatCap,
} from "@job-search-os/pipeline";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spendBreakdown, spendSince } from "../llm";
import {
  CV_RESERVE_TASK,
  CV_START_TASK,
  measureCvChat,
  releaseCvChatReservation,
  reserveCvChatStep,
  type CvChatMeasures,
} from "./reserve";

/**
 * S-1: dos pedidos en paralelo de la misma persona no pasan los dos el tope. Reserva en una transacción
 * corta con lock por persona; la llamada va afuera. Datos inventados.
 */
const USER = "00000000-0000-4000-8000-0000000c0125";
const OTHER = "00000000-0000-4000-8000-0000000c0126";
const LABEL = "cv:reserve-test";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const windows = (now: Date) => ({
  now,
  monthSince: new Date(now.getTime() - 30 * 86_400_000),
  daySince: new Date(now.getTime() - 86_400_000),
});

async function clean() {
  await conn.db.delete(s.llmCalls).where(like(s.llmCalls.label, "cv:reserve-test%"));
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
  if (isRemoteDatabase(ownerUrl)) throw new Error("reserve.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 6 });
}, 180_000);

beforeEach(clean);

afterAll(async () => {
  await clean();
  await conn?.close();
  await container?.stop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decideConversation = (m: CvChatMeasures): CvChatCap | null =>
  cvChatCapReason({
    turns: 1,
    conversationCostUsd: m.conversationCostUsd,
    cvThisMonth: m.cvThisMonth,
    cvPerMonth: 5,
    userInterviewSpendUsd: m.userInterviewUsd,
    dailySpendUsd: m.dailySpendUsd,
    dailyCapUsd: 10,
  });

/** El patrón de la ruta: reservar, «llamar» afuera, registrar el gasto real y soltar la reserva. */
async function turn(
  label: string,
  estimateUsd: number,
  realUsd: number,
): Promise<"paso" | CvChatCap> {
  const r = await reserveCvChatStep(conn.db, {
    userId: USER,
    label,
    step: "interview",
    estimateUsd,
    ...windows(new Date()),
    decide: decideConversation,
  });
  if (!r.ok) return r.reject;
  try {
    await sleep(150); // la llamada al modelo, fuera de la transacción
    await conn.db.insert(s.llmCalls).values({
      userId: USER,
      task: "cv_interview",
      model: "fake",
      ok: true,
      costUsd: realUsd,
      label,
    });
  } finally {
    await releaseCvChatReservation(conn.db, r.reservationId);
  }
  return "paso";
}

const seedSpent = (usd: number) =>
  conn.db.insert(s.llmCalls).values({
    userId: USER,
    task: "cv_interview",
    model: "fake",
    ok: true,
    costUsd: usd,
    label: LABEL,
  });

describe("intentos fallidos y turnos del mes (C2-1)", () => {
  const row = (over: Record<string, unknown>) =>
    conn.db.insert(s.llmCalls).values({
      userId: USER,
      task: "cv_interview",
      model: "fake",
      ok: true,
      costUsd: 0.01,
      label: LABEL,
      ...over,
    });
  const measure = () =>
    measureCvChat(conn.db, { userId: USER, label: LABEL, ...windows(new Date()) });

  it("un intento fallido (costo null) cuenta como turno y suma el máximo del paso", async () => {
    await row({});
    await row({ ok: false, costUsd: null, error: "schema_invalid" });
    const m = await measure();
    expect(m.interviewTurnsThisMonth).toBe(2);
    expect(m.userInterviewUsd).toBeCloseTo(0.01 + 0.025);
    expect(m.dailySpendUsd).toBeCloseTo(0.01 + 0.025);
  });

  it("provider_unavailable (nunca se llamó), otra persona y más de 30 días no cuentan", async () => {
    await row({ ok: false, costUsd: null, error: "provider_unavailable" });
    await row({ userId: OTHER });
    await row({ createdAt: new Date(Date.now() - 31 * 86_400_000) });
    const m = await measure();
    expect(m.interviewTurnsThisMonth).toBe(0);
  });

  it("un `write` fallido cuenta como CV del mes y como escritura de la charla", async () => {
    await row({ task: "cv_write", ok: false, costUsd: null, error: "timeout" });
    const m = await measure();
    expect(m.cvThisMonth).toBe(1);
    expect(m.writesInConversation).toBe(1);
  });

  it("39 turnos y dos pedidos en paralelo: pasa uno solo", async () => {
    for (let i = 0; i < 39; i++) await row({ label: `cv:reserve-test-t${i}`, costUsd: 0 });
    const go = async () => {
      const r = await reserveCvChatStep(conn.db, {
        userId: USER,
        label: LABEL,
        step: "interview",
        estimateUsd: 0.01,
        ...windows(new Date()),
        decide: (m) => cvChatMonthTurnsReason(m.interviewTurnsThisMonth),
      });
      if (!r.ok) return r.reject;
      await sleep(150);
      await releaseCvChatReservation(conn.db, r.reservationId);
      return "paso";
    };
    const out = await Promise.all([go(), go()]);
    expect([...out].sort()).toEqual(["paso", "turnos_mes"]);
  });
});

describe("reservas del chat de CV", () => {
  it("dos pedidos en paralelo: con lugar para uno, pasa uno y el otro se frena", async () => {
    // Gastado 0,10 de 0,15: cada paso reserva 0,05, así que el segundo ve 0,15 y no pasa
    await seedSpent(CV_CHAT_MAX_COST_USD - 0.05);
    const out = await Promise.all([turn(LABEL, 0.05, 0.05), turn(LABEL, 0.05, 0.05)]);
    expect([...out].sort()).toEqual(["conversacion", "paso"]);
  });

  it("con lugar para los dos pasan los dos", async () => {
    await seedSpent(0.01);
    const out = await Promise.all([turn(LABEL, 0.01, 0.01), turn(LABEL, 0.01, 0.01)]);
    expect(out).toEqual(["paso", "paso"]);
  });

  it("al terminar la reserva se borra y queda solo el gasto real", async () => {
    await turn(LABEL, 0.05, 0.02);
    const rows = await conn.db.select().from(s.llmCalls).where(eq(s.llmCalls.label, LABEL));
    expect(rows.map((r) => r.task)).toEqual(["cv_interview"]);
  });

  it("una reserva vencida (más de 2 minutos, proceso muerto) ya no cuenta", async () => {
    const now = new Date();
    await conn.db.insert(s.llmCalls).values({
      userId: USER,
      task: CV_RESERVE_TASK,
      model: "interview",
      ok: true,
      tokensOut: 140_000,
      costUsd: null,
      label: LABEL,
      createdAt: new Date(now.getTime() - 3 * 60_000),
    });
    const m = await measureCvChat(conn.db, { userId: USER, label: LABEL, ...windows(now) });
    expect(m.conversationCostUsd).toBe(0);
    // y una vigente sí
    await conn.db.insert(s.llmCalls).values({
      userId: USER,
      task: CV_RESERVE_TASK,
      model: "interview",
      ok: true,
      tokensOut: 140_000,
      costUsd: null,
      label: LABEL,
    });
    const live = await measureCvChat(conn.db, {
      userId: USER,
      label: LABEL,
      ...windows(new Date()),
    });
    expect(live.conversationCostUsd).toBeCloseTo(0.14);
    expect(live.userInterviewUsd).toBeCloseTo(0.14);
    expect(live.dailySpendUsd).toBeCloseTo(0.14);
  });

  it("las reservas de otra persona suman al tope global y no al de la persona", async () => {
    await conn.db.insert(s.llmCalls).values({
      userId: OTHER,
      task: CV_RESERVE_TASK,
      model: "interview",
      ok: true,
      tokensOut: 50_000,
      costUsd: null,
      label: "cv:reserve-test-otra",
    });
    const m = await measureCvChat(conn.db, { userId: USER, label: LABEL, ...windows(new Date()) });
    expect(m.dailySpendUsd).toBeCloseTo(0.05);
    expect(m.userInterviewUsd).toBe(0);
    expect(m.conversationCostUsd).toBe(0);
  });

  it("dos `write` de charlas distintas en paralelo: con cupo de 1 pasa uno", async () => {
    const write = async (label: string) => {
      const r = await reserveCvChatStep(conn.db, {
        userId: USER,
        label,
        step: "write",
        estimateUsd: 0.05,
        ...windows(new Date()),
        decide: (m) => (m.cvThisMonth >= 1 ? ("mes" as const) : null),
      });
      if (!r.ok) return r.reject;
      await sleep(150);
      await releaseCvChatReservation(conn.db, r.reservationId);
      return "paso";
    };
    const out = await Promise.all([write("cv:reserve-test-a"), write("cv:reserve-test-b")]);
    expect([...out].sort()).toEqual(["mes", "paso"]);
  });

  it("dos `start` en paralelo no pasan el tope de 5 por día", async () => {
    const start = async () => {
      const r = await reserveCvChatStep(conn.db, {
        userId: USER,
        label: `cv:reserve-test-${Math.random().toString(16).slice(2, 10)}`,
        step: "start",
        estimateUsd: 0,
        ...windows(new Date()),
        decide: (m) => cvChatStartCapReason(m.startsToday),
      });
      return r.ok ? "paso" : r.reject;
    };
    // Cuatro ya hechos; salen 6 en paralelo con lugar para uno
    for (let i = 0; i < 4; i++) {
      await conn.db.insert(s.llmCalls).values({
        userId: USER,
        task: CV_START_TASK,
        model: "none",
        ok: true,
        costUsd: 0,
        label: `cv:reserve-test-previo${i}`,
      });
    }
    const out = await Promise.all(Array.from({ length: 6 }, start));
    expect(out.filter((x) => x === "paso")).toHaveLength(1);
    expect(out.filter((x) => x === "inicios")).toHaveLength(5);
  });

  it("las filas cv_reserve y cv_start no suman USD, llamadas ni fallidas en los reportes de gasto", async () => {
    const now = new Date();
    await conn.db.insert(s.llmCalls).values([
      {
        userId: USER,
        task: CV_RESERVE_TASK,
        model: "write",
        ok: true,
        tokensOut: 50_000,
        costUsd: null,
        label: LABEL,
      },
      {
        userId: USER,
        task: CV_START_TASK,
        model: "none",
        ok: true,
        tokensOut: 0,
        costUsd: 0,
        label: LABEL,
      },
      {
        userId: USER,
        task: "cv_interview",
        model: "fake",
        ok: true,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.01,
        label: LABEL,
      },
    ]);
    const since = new Date(now.getTime() - 60_000);
    const total = await spendSince(conn.db, since, { userId: USER });
    expect(total).toMatchObject({ calls: 1, failedCalls: 0, unpricedCalls: 0, tokensOut: 5 });
    expect(total.usd).toBeCloseTo(0.01);
    const breakdown = await spendBreakdown(conn.db, since);
    const mine = breakdown.filter((b) => b.task.startsWith("cv_"));
    expect(mine.map((b) => b.task)).toEqual(["cv_interview"]);
  });
});
