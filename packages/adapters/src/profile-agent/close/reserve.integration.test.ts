import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { releaseCvChatReservation } from "../../cv-chat/reserve";
import {
  measureProfileAgentUserSpendUsd,
  recordProfileAgentWriteFailure,
  reserveProfileAgentWrite,
} from "./reserve";

/**
 * ADR-034 §6 (O1, R10-5): los topes del paso de redacción cuentan las llamadas fallidas (`cost_usd` null)
 * y una redacción por charla, también con dos pedidos en paralelo. Datos inventados.
 */
const USER = "00000000-0000-4000-8000-0000000c1005";
const OTHER = "00000000-0000-4000-8000-0000000c1006";
const FLOW = "aaaaaaaaaaaa";
const LABEL = `cv:${FLOW}`;
const TAG = "cv:aaaaaaaaaaaa";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function clean() {
  await conn.db.delete(s.llmCalls).where(like(s.llmCalls.label, `${TAG}%`));
  await conn.db.delete(s.llmCalls).where(like(s.llmCalls.label, "cv:bbbbbbbbbbb%"));
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
  if (isRemoteDatabase(ownerUrl)) throw new Error("close.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 6 });
}, 180_000);

beforeEach(clean);

afterAll(async () => {
  await clean();
  await conn?.close();
  await container?.stop();
});

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

const slot = (over: Partial<Parameters<typeof reserveProfileAgentWrite>[1]> = {}) =>
  reserveProfileAgentWrite(conn.db, {
    userId: USER,
    flowId: FLOW,
    now: new Date(),
    planCvPerMonth: 1,
    env: {},
    callsModel: true,
    ...over,
  });

describe("redacción del cierre: topes con filas de costo null", () => {
  it("pasa con una charla limpia y deja la reserva", async () => {
    const r = await slot();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reservationId).not.toBeNull();
    if (r.ok) await releaseCvChatReservation(conn.db, r.reservationId);
  });

  it("el tope por charla cuenta las llamadas fallidas (costo null)", async () => {
    // 4 turnos fallidos × 0,03 de estimado = 0,12: todavía por debajo de 0,30
    for (let i = 0; i < 4; i++) await row({ ok: false, costUsd: null, error: "schema_invalid" });
    expect((await slot()).ok).toBe(true);
    // 5 redacciones fallidas × 0,07 = 0,35 ≥ 0,30: ninguna tenía costo y el tope las ve
    await clean();
    for (let i = 0; i < 5; i++) {
      await row({ task: "cv_write", ok: false, costUsd: null, error: "timeout" });
    }
    const r = await slot();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject).toBe("charla");
  });

  it("el tope por persona y día cuenta lectura, huecos y redacción fallidos de otras charlas", async () => {
    // 6 lecturas fallidas × 0,08 = 0,48 y 1 turno fallido × 0,03 → 0,51 ≥ 0,50
    for (let i = 0; i < 6; i++) {
      await row({
        task: "extract_cv_profile",
        label: "cv:bbbbbbbbbbbb",
        ok: false,
        costUsd: null,
        error: "output_invalid",
      });
    }
    await row({ label: "cv:bbbbbbbbbbbb", ok: false, costUsd: null, error: "timeout" });
    const spent = await measureProfileAgentUserSpendUsd(conn.db, {
      userId: USER,
      daySince: new Date(Date.now() - 86_400_000),
    });
    expect(spent).toBeCloseTo(0.51);
    const r = await slot();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject).toBe("usuario");
  });

  it("provider_unavailable, otra persona, costo real y más de 24 h se miden como corresponde", async () => {
    await row({ ok: false, costUsd: null, error: "provider_unavailable" });
    await row({ userId: OTHER, ok: false, costUsd: null, error: "timeout" });
    await row({ costUsd: 0.02 });
    await row({ createdAt: new Date(Date.now() - 2 * 86_400_000), costUsd: 0.4 });
    const spent = await measureProfileAgentUserSpendUsd(conn.db, {
      userId: USER,
      daySince: new Date(Date.now() - 86_400_000),
    });
    expect(spent).toBeCloseTo(0.02);
  });

  it("un costo negativo cae al estimado y no resta del tope", async () => {
    await row({ ok: false, costUsd: -5, error: "timeout" });
    const spent = await measureProfileAgentUserSpendUsd(conn.db, {
      userId: USER,
      daySince: new Date(Date.now() - 86_400_000),
    });
    // ok = false con costo inválido → estimado del paso (cv_interview: 0,03); con ok = true valdría el negativo
    expect(spent).toBeCloseTo(0.03);
  });

  it("el tope global diario cierra con un valor mal escrito", async () => {
    const r = await slot({ env: { CV_PROFILE_AGENT_DAILY_CAP_USD: "mucho" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject).toBe("global");
  });
});

describe("una redacción por charla y cupo de CV por mes", () => {
  it("dos pedidos en paralelo de la misma charla: pasa uno solo", async () => {
    const [a, b] = await Promise.all([slot(), slot()]);
    const ok = [a, b].filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    const rejected = [a, b].find((r) => !r.ok);
    expect(rejected && !rejected.ok && rejected.reject).toBe("already_written");
    for (const r of [a, b]) if (r.ok) await releaseCvChatReservation(conn.db, r.reservationId);
  });

  it("una redacción ya hecha en la charla la rechaza", async () => {
    await row({ task: "cv_write", costUsd: 0.02 });
    const r = await slot();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject).toBe("already_written");
  });

  it("el cupo de CV por mes (mínimo 3 de la beta) corta la cuarta charla", async () => {
    for (const id of ["bbbbbbbbbbb1", "bbbbbbbbbbb2", "bbbbbbbbbbb3"]) {
      await row({ task: "cv_write", costUsd: 0.01, label: `cv:${id}` });
    }
    const r = await slot();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject).toBe("cv_mes");
  });

  it("si la redacción lanzó antes de registrar su fila, el intento igual cuenta y no se reintenta gratis", async () => {
    const first = await slot();
    expect(first.ok).toBe(true);
    // la llamada lanza: se anota la fila fallida y recién después se suelta la reserva
    await recordProfileAgentWriteFailure(conn.db, { userId: USER, flowId: FLOW });
    if (first.ok) await releaseCvChatReservation(conn.db, first.reservationId);
    const retry = await slot();
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.reject).toBe("already_written");
    // y suma el estimado del paso al gasto de la charla
    expect(retry.measures.conversationCostUsd).toBeCloseTo(0.07);
  });

  it("sin llamada al modelo solo mide: no deja reserva", async () => {
    const r = await slot({ callsModel: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reservationId).toBeNull();
  });
});
