import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import {
  CV_CHAT_MAX_STARTS_PER_DAY,
  PROFILE_AGENT_MAX_GAP_TURNS,
  profileAgentWindows,
} from "@job-search-os/pipeline";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { releaseCvChatReservation } from "../../cv-chat/reserve";
import { measureGaps, reserveGapStep, type GapReject } from "./reserve";

/**
 * ADR-034 §5 y §6 en la etapa de huecos, contra Postgres real y con datos inventados:
 * - O3: el `start` cuenta en los 5 por día aunque el pedido no traiga ticket;
 * - O1: el gasto cuenta las llamadas fallidas (costo null) por charla, por persona y global;
 * - los turnos se cuentan en `llm_calls` por `label`, no por lo que diga el navegador.
 */
const USER = "00000000-0000-4000-8000-0000000d1031";
const OTHER = "00000000-0000-4000-8000-0000000d1032";
const PREFIX = "cv:gaps-test";
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
    throw new Error("gaps reserve.integration: DATABASE_URL no es local");
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
    task: "cv_interview",
    model: "fake",
    ok: true,
    costUsd: 0.01,
    label: LABEL,
    ...over,
  });

const reserve = (
  step: "turn" | "check" | "start",
  over: { label?: string; dailyCapUsd?: number; userId?: string } = {},
) =>
  reserveGapStep(conn.db, {
    userId: over.userId ?? USER,
    label: over.label ?? LABEL,
    step,
    dailyCapUsd: over.dailyCapUsd ?? 100,
    ...clock(),
  });

describe("O3: el `start` sin ticket cuenta en los 5 por día", () => {
  it("varios pedidos seguidos, cada uno con su charla nueva, y el sexto se frena", async () => {
    const results: (GapReject | "ok")[] = [];
    for (let i = 0; i < CV_CHAT_MAX_STARTS_PER_DAY + 2; i++) {
      // sin ticket: cada pedido abre un `flowId` nuevo, como hace la ruta
      const r = await reserve("start", { label: `${PREFIX}-nuevo-${i}` });
      results.push(r.ok ? "ok" : r.reject);
    }
    expect(results.slice(0, CV_CHAT_MAX_STARTS_PER_DAY)).toEqual(
      Array(CV_CHAT_MAX_STARTS_PER_DAY).fill("ok"),
    );
    expect(results.slice(CV_CHAT_MAX_STARTS_PER_DAY)).toEqual(["inicios", "inicios"]);
  });

  it("en paralelo tampoco pasan más de 5 (lock por persona)", async () => {
    const rs = await Promise.all(
      Array.from({ length: 9 }, (_, i) => reserve("start", { label: `${PREFIX}-par-${i}` })),
    );
    expect(rs.filter((r) => r.ok)).toHaveLength(CV_CHAT_MAX_STARTS_PER_DAY);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.reject === "inicios")).toBe(true);
  });

  it("es por persona: otra no se ve afectada", async () => {
    for (let i = 0; i < CV_CHAT_MAX_STARTS_PER_DAY; i++)
      await reserve("start", { label: `${PREFIX}-a-${i}` });
    expect((await reserve("start", { label: `${PREFIX}-b` })).ok).toBe(false);
    expect((await reserve("start", { label: `${PREFIX}-c`, userId: OTHER })).ok).toBe(true);
  });
});

describe("O1: el gasto cuenta las llamadas fallidas con costo null", () => {
  const measure = (label = LABEL) => measureGaps(conn.db, { userId: USER, label, ...clock() });

  it("una llamada fallida suma el estimado del paso, por tarea", async () => {
    await call({ ok: false, costUsd: null, error: "timeout" });
    await call({ task: "extract_cv_profile", ok: false, costUsd: null, error: "output_invalid" });
    await call({ task: "cv_write", ok: false, costUsd: null, error: "llm_failed" });
    const m = await measure();
    expect(m.flowCostUsd).toBeCloseTo(0.03 + 0.08 + 0.07);
    expect(m.userSpendTodayUsd).toBeCloseTo(0.03 + 0.08 + 0.07);
    expect(m.dailySpendUsd).toBeCloseTo(0.03 + 0.08 + 0.07);
  });

  it("un costo negativo cae al estimado (nunca resta); uno real se respeta", async () => {
    await call({ costUsd: -5 });
    await call({ costUsd: 0.004 });
    expect((await measure()).flowCostUsd).toBeCloseTo(0.03 + 0.004);
  });

  it("provider_unavailable (nunca se llamó), otra persona y más de un día no cuentan", async () => {
    await call({ ok: false, costUsd: null, error: "provider_unavailable" });
    await call({ userId: OTHER, costUsd: null, ok: false, error: "timeout" });
    await call({ createdAt: new Date(Date.now() - 2 * 86_400_000), costUsd: 0.2 });
    const m = await measure();
    // la charla suma su fila vieja (el gasto por charla no tiene ventana); el día de la persona no suma nada
    expect(m.flowCostUsd).toBeCloseTo(0.2);
    expect(m.userSpendTodayUsd).toBe(0);
    // el global sí suma la llamada fallida de la otra persona
    expect(m.dailySpendUsd).toBeCloseTo(0.03);
  });

  it("tope por charla: diez turnos fallidos (costo null) frenan el siguiente", async () => {
    for (let i = 0; i < 10; i++) await call({ ok: false, costUsd: null, error: "timeout" });
    const r = await reserve("turn");
    expect(r).toMatchObject({ ok: false, reject: "charla" });
  });

  it("tope por persona y día: fallidas de varias charlas, cada una por debajo del tope de la charla", async () => {
    for (let i = 0; i < 17; i++) {
      await call({ ok: false, costUsd: null, error: "timeout", label: `${PREFIX}-otra-${i % 3}` });
    }
    // 17 × 0,03 = 0,51 repartidos en 3 charlas (0,17 cada una); esta charla está en cero
    const r = await reserve("turn");
    expect(r).toMatchObject({ ok: false, reject: "usuario" });
  });

  it("tope global: las llamadas fallidas de otras personas cuentan", async () => {
    for (let i = 0; i < 3; i++) {
      await call({
        userId: OTHER,
        ok: false,
        costUsd: null,
        error: "timeout",
        label: `${PREFIX}-ajena`,
      });
    }
    // 3 × 0,03 = 0,09 de otra persona; con un tope global de 0,05 se cierra
    expect(await reserve("turn", { dailyCapUsd: 0.05 })).toMatchObject({
      ok: false,
      reject: "global",
    });
    expect((await reserve("turn", { dailyCapUsd: 0.5 })).ok).toBe(true);
  });
});

describe("turnos por charla, medidos en llm_calls", () => {
  it("20 llamadas a cv_interview con su label frenan la 21; otra charla no se ve afectada", async () => {
    for (let i = 0; i < PROFILE_AGENT_MAX_GAP_TURNS; i++) await call({ costUsd: 0 });
    expect(await reserve("turn")).toMatchObject({ ok: false, reject: "turnos" });
    expect((await reserve("turn", { label: `${PREFIX}-otra` })).ok).toBe(true);
    // cerrar o saltear no llama al modelo: no lo frena el tope de turnos
    expect((await reserve("check")).ok).toBe(true);
  });

  it("los intentos fallidos cuentan como turno; provider_unavailable no", async () => {
    for (let i = 0; i < PROFILE_AGENT_MAX_GAP_TURNS - 1; i++) await call({ costUsd: 0 });
    await call({ ok: false, costUsd: null, error: "provider_unavailable" });
    expect((await measureGaps(conn.db, { userId: USER, label: LABEL, ...clock() })).gapTurns).toBe(
      PROFILE_AGENT_MAX_GAP_TURNS - 1,
    );
    await call({ ok: false, costUsd: 0, error: "schema_invalid" });
    expect(await reserve("turn")).toMatchObject({ ok: false, reject: "turnos" });
  });
});

describe("O-A: las reservas vivas cuentan como turnos", () => {
  it("con 19 turnos hechos, solo una de dos `answer` en paralelo pasa", async () => {
    for (let i = 0; i < PROFILE_AGENT_MAX_GAP_TURNS - 1; i++) await call({ costUsd: 0 });
    const rs = await Promise.all([reserve("turn"), reserve("turn")]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toMatchObject({ reject: "turnos" });
  });

  it("la reserva de otra charla o ya soltada no suma", async () => {
    const other = await reserve("turn", { label: `${PREFIX}-otra` });
    if (!other.ok) throw new Error("debía pasar");
    expect((await measureGaps(conn.db, { userId: USER, label: LABEL, ...clock() })).gapTurns).toBe(
      0,
    );
    await releaseCvChatReservation(conn.db, other.reservationId);
  });
});

describe("reservas", () => {
  it("la reserva de un turno cuenta mientras está viva y se borra al soltarla", async () => {
    const r = await reserve("turn");
    if (!r.ok) throw new Error("debía pasar");
    expect(r.reservationId).not.toBeNull();
    const during = await measureGaps(conn.db, { userId: USER, label: LABEL, ...clock() });
    expect(during.flowCostUsd).toBeCloseTo(0.03);
    expect(await releaseCvChatReservation(conn.db, r.reservationId)).toBe(true);
    const after = await measureGaps(conn.db, { userId: USER, label: LABEL, ...clock() });
    expect(after.flowCostUsd).toBe(0);
  });
});
