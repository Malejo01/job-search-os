import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { measureProfileAgentUserSpendUsd } from "./close/reserve";
import { measureGaps } from "./gaps/reserve";
import { measureProfileAgentSpend } from "./measure";
import { measureProfileRead } from "./read/reserve";

/**
 * R11-1: una sola medición del gasto del agente. Las tres etapas (lectura, huecos, cierre) tienen que dar el
 * mismo número con las mismas filas, y las llamadas fallidas (`cost_usd` null) cuentan como el estimado de su
 * paso. Datos inventados.
 */
const USER = "00000000-0000-4000-8000-0000000c1101";
const OTHER = "00000000-0000-4000-8000-0000000c1102";
const LABEL = "cv:cccccccccccc";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function clean() {
  await conn.db.delete(s.llmCalls).where(like(s.llmCalls.label, "cv:cccccccccccc%"));
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
  if (isRemoteDatabase(ownerUrl)) throw new Error("measure.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 4 });
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

const daySince = () => new Date(Date.now() - 86_400_000);

describe("medición única del gasto del agente", () => {
  it("lectura, huecos y cierre dan el mismo gasto con las mismas filas", async () => {
    await row({ task: "extract_cv_profile", ok: false, costUsd: null, error: "timeout" });
    await row({ ok: false, costUsd: null, error: "schema_invalid" });
    await row({ task: "cv_write", costUsd: 0.02 });
    await row({ costUsd: -3, ok: false, error: "timeout" });
    await row({ ok: false, costUsd: null, error: "provider_unavailable" });
    await row({ userId: OTHER, task: "cv_write", ok: false, costUsd: null, error: "timeout" });
    // 0,08 (lectura fallida) + 0,03 (turno fallido) + 0,02 (redacción) + 0,03 (negativo → estimado) = 0,16
    const expected = 0.16;

    const shared = await measureProfileAgentSpend(conn.db, { userId: USER, daySince: daySince() });
    expect(shared.userUsd).toBeCloseTo(expected);
    // la persona ajena suma al global (0,07 de su redacción fallida); la base puede tener otras filas
    expect(shared.dailyUsd).toBeGreaterThanOrEqual(expected + 0.07 - 1e-9);

    const read = await measureProfileRead(conn.db, {
      userId: USER,
      monthSince: new Date(Date.now() - 30 * 86_400_000),
      daySince: daySince(),
      now: new Date(),
    });
    const gaps = await measureGaps(conn.db, {
      userId: USER,
      label: LABEL,
      daySince: daySince(),
      now: new Date(),
    });
    const close = await measureProfileAgentUserSpendUsd(conn.db, {
      userId: USER,
      daySince: daySince(),
    });

    expect(read.userSpendTodayUsd).toBeCloseTo(expected);
    expect(gaps.userSpendTodayUsd).toBeCloseTo(expected);
    expect(close).toBeCloseTo(expected);
    expect(read.dailySpendUsd).toBeCloseTo(shared.dailyUsd);
    expect(gaps.dailySpendUsd).toBeCloseTo(shared.dailyUsd);
  });

  it("las filas de más de 24 h y las de otras tareas no cuentan", async () => {
    await row({ task: "cv_write", createdAt: new Date(Date.now() - 2 * 86_400_000), costUsd: 0.5 });
    await row({ task: "profile_read", model: "none", costUsd: 0 });
    const shared = await measureProfileAgentSpend(conn.db, { userId: USER, daySince: daySince() });
    expect(shared.userUsd).toBe(0);
  });
});
