import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import {
  CV_COACH_MAX_FLOW_COST_USD,
  CV_COACH_MAX_REVIEWS,
  CV_COACH_MAX_TURNS,
  CV_COACH_RESERVE_USD,
  PROFILE_AGENT_USER_DAILY_CAP_USD,
  profileAgentWindows,
} from "@job-search-os/pipeline";
import { like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CV_RESERVE_LOCK_NAMESPACE } from "../cv-chat/reserve";
import {
  measureCvCoach,
  releaseCvCoachReservation,
  reserveCvCoachStep,
  type CvCoachReserveStep,
} from "./reserve";

/**
 * ADR-038 §9 contra Postgres real, con datos inventados:
 * - turnos y diagnósticos se cuentan en `llm_calls` por `label`, también los fallidos;
 * - O1 (ADR-034): una fila fallida con `cost_usd` null vale la reserva de su paso, por charla, por persona
 *   y global;
 * - la redacción queda reservada: un turno se corta antes de dejar sin lugar a `cv_write`;
 * - dos pedidos en paralelo no pasan el tope (lock por persona).
 */
const USER = "00000000-0000-4000-8000-0000000c0a01";
const OTHER = "00000000-0000-4000-8000-0000000c0a02";
const PREFIX = "cv:coach-test";
const LABEL = `${PREFIX}-flow`;

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const clock = () => {
  const now = new Date();
  return { now, daySince: profileAgentWindows(now).daySince };
};

async function clean() {
  await conn.db.delete(s.llmCalls).where(like(s.llmCalls.label, `${PREFIX}%`));
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
  if (isRemoteDatabase(ownerUrl))
    throw new Error("cv-coach reserve.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 8 });
}, 180_000);

beforeEach(clean);

afterAll(async () => {
  await clean();
  await conn?.close();
  await container?.stop();
});

const call = (over: Record<string, unknown>) =>
  conn.db.insert(s.llmCalls).values({
    userId: USER,
    task: "cv_coach_turn",
    model: "fake",
    ok: true,
    costUsd: 0.001,
    label: LABEL,
    ...over,
  });

const reserve = (
  step: CvCoachReserveStep,
  over: { label?: string; dailyCapUsd?: number; userId?: string } = {},
) =>
  reserveCvCoachStep(conn.db, {
    userId: over.userId ?? USER,
    label: over.label ?? LABEL,
    step,
    dailyCapUsd: over.dailyCapUsd ?? 100,
    ...clock(),
  });

const measure = () => measureCvCoach(conn.db, { userId: USER, label: LABEL, ...clock() });

describe("conteos por charla (label), no por el navegador", () => {
  it("turnos y diagnósticos cuentan los fallidos; provider_unavailable no", async () => {
    await call({});
    await call({ ok: false, costUsd: null, error: "output_invalid" });
    await call({ ok: false, costUsd: null, error: "provider_unavailable" });
    await call({ task: "cv_review", costUsd: 0.002 });
    await call({ task: "cv_review", label: `${PREFIX}-otra` });
    const m = await measure();
    expect(m.turns).toBe(2);
    expect(m.reviews).toBe(1);
    expect(m.written).toBe(false);
  });

  it("un segundo diagnóstico pasa (reintento) y el tercero se corta", async () => {
    await call({ task: "cv_review", ok: false, costUsd: null, error: "timeout" });
    const second = await reserve("review");
    expect(second.ok).toBe(true);
    // la reserva viva cuenta: un pedido en paralelo no saca un tercero
    const third = await reserve("review");
    expect(third.ok ? "ok" : third.reject).toBe("diagnosticos");
    expect(CV_COACH_MAX_REVIEWS).toBe(2);
  });

  it(`corta en el turno ${CV_COACH_MAX_TURNS}`, async () => {
    for (let i = 0; i < CV_COACH_MAX_TURNS - 1; i++) await call({ costUsd: 0 });
    const last = await reserve("turn");
    expect(last.ok).toBe(true);
    const over = await reserve("turn");
    expect(over.ok ? "ok" : over.reject).toBe("turnos");
  });

  it("una redacción lograda deja de reservarse", async () => {
    await call({ task: "cv_write", ok: false, costUsd: null, error: "timeout" });
    expect((await measure()).written).toBe(false);
    await call({ task: "cv_write", costUsd: 0.01 });
    expect((await measure()).written).toBe(true);
  });
});

describe("O1: filas de costo null valen la reserva de su paso", () => {
  it("por charla: lectura, diagnóstico, turno y redacción fallidos", async () => {
    await call({ task: "extract_cv_profile", ok: false, costUsd: null, error: "timeout" });
    await call({ task: "cv_review", ok: false, costUsd: null, error: "timeout" });
    await call({ task: "cv_coach_turn", ok: false, costUsd: null, error: "output_invalid" });
    await call({ task: "cv_write", ok: false, costUsd: null, error: "exception" });
    // un costo negativo también cae a la reserva: nunca resta
    await call({ task: "cv_coach_turn", costUsd: -5 });
    const m = await measure();
    const expected =
      CV_COACH_RESERVE_USD.read +
      CV_COACH_RESERVE_USD.review +
      CV_COACH_RESERVE_USD.turn * 2 +
      CV_COACH_RESERVE_USD.write;
    expect(m.flowCostUsd).toBeCloseTo(expected, 6);
  });

  it("la redacción queda reservada: el turno se corta antes que la charla se quede sin CV", async () => {
    // gastado real: justo lo que deja lugar para un turno y la redacción
    const room =
      CV_COACH_MAX_FLOW_COST_USD - CV_COACH_RESERVE_USD.turn - CV_COACH_RESERVE_USD.write;
    await call({ task: "extract_cv_profile", costUsd: room - 0.001 });
    const r = await reserve("turn");
    expect(r.ok).toBe(true);
    if (r.ok)
      await releaseCvCoachReservation(conn.db, { userId: USER, reservationId: r.reservationId });
    // una fila fallida de turno (null → 0,04) se come ese lugar
    await call({ ok: false, costUsd: null, error: "timeout" });
    const capped = await reserve("turn");
    expect(capped.ok ? "ok" : capped.reject).toBe("charla");
  });

  it("persona-día: suma el agente de perfil, el coach (null incluido) y otras charlas", async () => {
    const before = await measure();
    await call({
      label: `${PREFIX}-otra`,
      task: "cv_review",
      ok: false,
      costUsd: null,
      error: "x",
    });
    await call({ label: `${PREFIX}-otra2`, task: "cv_interview", costUsd: 0.1 });
    const after = await measure();
    expect(after.userSpendTodayUsd - before.userSpendTodayUsd).toBeCloseTo(
      CV_COACH_RESERVE_USD.review + 0.1,
      6,
    );
    // lo de otra persona no cuenta para la persona, sí para el global
    await call({ userId: OTHER, label: `${PREFIX}-ajena`, costUsd: null, ok: false, error: "x" });
    const third = await measure();
    expect(third.userSpendTodayUsd).toBeCloseTo(after.userSpendTodayUsd, 6);
    expect(third.dailySpendUsd - after.dailySpendUsd).toBeCloseTo(CV_COACH_RESERVE_USD.turn, 6);
  });

  it("tope por persona y día compartido con el agente de perfil", async () => {
    await call({
      label: `${PREFIX}-otra`,
      task: "cv_write",
      costUsd: PROFILE_AGENT_USER_DAILY_CAP_USD,
    });
    const r = await reserve("review");
    expect(r.ok ? "ok" : r.reject).toBe("usuario");
  });

  it("tope global: con el tope en 0 se corta (falla cerrado)", async () => {
    const r = await reserve("turn", { dailyCapUsd: 0 });
    expect(r.ok ? "ok" : r.reject).toBe("global");
  });
});

describe("reservas y paralelo", () => {
  it("la reserva suma el máximo del paso y se suelta", async () => {
    const r = await reserve("review");
    expect(r.ok).toBe(true);
    const m = await measure();
    expect(m.flowCostUsd).toBeCloseTo(CV_COACH_RESERVE_USD.review, 6);
    expect(m.reviews).toBe(1);
    if (r.ok)
      expect(
        await releaseCvCoachReservation(conn.db, { userId: USER, reservationId: r.reservationId }),
      ).toBe(true);
    const after = await measure();
    expect(after.flowCostUsd).toBe(0);
    expect(after.reviews).toBe(0);
  });

  it("muchos turnos en paralelo no pasan el tope de la charla", async () => {
    // lugar para exactamente dos turnos más con la redacción reservada
    const room =
      CV_COACH_MAX_FLOW_COST_USD - 2 * CV_COACH_RESERVE_USD.turn - CV_COACH_RESERVE_USD.write;
    await call({ task: "extract_cv_profile", costUsd: room - 0.001 });
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve("turn")));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reject === "charla")).toBe(true);
  });

  it("la reserva se suelta bajo el lock: quien está midiendo la sigue viendo (R12-16)", async () => {
    // Determinista: otro pedido de la misma persona tiene el lock y mide en varias consultas; el release
    // tiene que esperar a que termine, así no queda una foto sin la reserva ni la fila real
    const r = await reserve("turn");
    if (!r.ok) throw new Error("la reserva tenía que pasar");
    let release: Promise<boolean> | null = null;
    const seen = await conn.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${USER}, ${CV_RESERVE_LOCK_NAMESPACE}))`,
      );
      const before = await measureCvCoach(tx, { userId: USER, label: LABEL, ...clock() });
      release = releaseCvCoachReservation(conn.db, {
        userId: USER,
        reservationId: r.reservationId,
      });
      await new Promise((done) => setTimeout(done, 300));
      const after = await measureCvCoach(tx, { userId: USER, label: LABEL, ...clock() });
      return { before, after };
    });
    expect(await release).toBe(true);
    expect(seen.before.turns).toBe(1);
    expect(seen.after.turns).toBe(1);
    expect(seen.after.flowCostUsd).toBeCloseTo(CV_COACH_RESERVE_USD.turn, 6);
    // después del release, suelta
    expect((await measure()).turns).toBe(0);
  });

  it("el release no borra la reserva de otra persona ni lanza", async () => {
    const r = await reserve("review");
    if (!r.ok) throw new Error("la reserva tenía que pasar");
    expect(
      await releaseCvCoachReservation(conn.db, { userId: OTHER, reservationId: r.reservationId }),
    ).toBe(true);
    expect((await measure()).reviews).toBe(1);
    expect(
      await releaseCvCoachReservation(conn.db, { userId: USER, reservationId: "no-es-uuid" }),
    ).toBe(false);
    expect(await releaseCvCoachReservation(conn.db, { userId: USER, reservationId: null })).toBe(
      true,
    );
  });
});
