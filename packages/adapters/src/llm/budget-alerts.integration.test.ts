import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_ALERT_TASK,
  budgetAlertsSentToday,
  checkBudgetAlertsAfterEvaluation,
  createDbBudgetAlertStore,
  resetBudgetAlertMemoForTests,
  runBudgetAlerts,
  spentLast24hUsd,
} from "./budget-alerts";
import { spendLast24h } from "./spend";

/** Alertas de presupuesto (R7-1) contra Postgres real, con el store real, un fake de Resend y datos ficticios. */
const NOW = new Date("2026-12-10T15:00:00.000Z");
const ENV = {
  LLM_DAILY_CAP_USD: "2",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Aviso <aviso@example.test>",
  AUTH_URL: "https://app.example.test",
  ADMIN_EMAILS: "admin@ejemplo.test",
};

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

async function setSpend(usd: number): Promise<void> {
  await conn.db.delete(s.llmCalls);
  if (usd > 0) {
    await conn.db.insert(s.llmCalls).values({
      task: "evaluate_job",
      model: "modelo-ficticio",
      ok: true,
      costUsd: usd,
      createdAt: new Date(NOW.getTime() - 3_600_000),
    });
  }
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
}, 180_000);

afterAll(async () => {
  await conn?.db.delete(s.llmCalls);
  await conn?.close();
  await container?.stop();
});

describe("alertas de presupuesto con el store real (R7-1)", () => {
  beforeEach(async () => {
    await conn.db.delete(s.llmCalls);
  });

  it("no manda dos veces el mismo umbral el mismo día, aunque el cron corra dos veces", async () => {
    await setSpend(1.5);
    const store = createDbBudgetAlertStore(conn.db);
    const send = vi.fn().mockResolvedValue(undefined);
    const deps = {
      store,
      spentUsd: spentLast24hUsd(conn.db, NOW),
      env: ENV,
      now: NOW,
      logger,
      send,
    };
    const first = await runBudgetAlerts(deps);
    const second = await runBudgetAlerts({ ...deps, now: new Date(NOW.getTime() + 3_600_000) });
    expect(first.alerted).toEqual([70]);
    expect(second.alerted).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await budgetAlertsSentToday(conn.db, NOW)).toEqual([70]);
  });

  it("dos corridas en paralelo mandan un solo email", async () => {
    await setSpend(1.5);
    const store = createDbBudgetAlertStore(conn.db);
    const send = vi.fn().mockResolvedValue(undefined);
    const deps = {
      store,
      spentUsd: spentLast24hUsd(conn.db, NOW),
      env: ENV,
      now: NOW,
      logger,
      send,
    };
    const results = await Promise.all([runBudgetAlerts(deps), runBudgetAlerts(deps)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.flatMap((r) => r.alerted)).toEqual([70]);
  });

  it("al día siguiente vuelve a avisar, y un umbral más alto se avisa aparte", async () => {
    await setSpend(1.5);
    const store = createDbBudgetAlertStore(conn.db);
    const send = vi.fn().mockResolvedValue(undefined);
    const base = { store, env: ENV, logger, send };
    await runBudgetAlerts({ ...base, now: NOW, spentUsd: async () => 1.5 });
    const up = await runBudgetAlerts({ ...base, now: NOW, spentUsd: async () => 1.75 });
    expect(up.alerted).toEqual([85]);
    const tomorrow = new Date("2026-12-11T09:00:00.000Z");
    const next = await runBudgetAlerts({ ...base, now: tomorrow, spentUsd: async () => 1.5 });
    expect(next.alerted).toEqual([70]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("si el envío falla se devuelve la marca y la próxima corrida reintenta", async () => {
    await setSpend(1.5);
    const store = createDbBudgetAlertStore(conn.db);
    const deps = { store, spentUsd: async () => 1.5, env: ENV, now: NOW, logger };
    const bad = await runBudgetAlerts({
      ...deps,
      send: vi.fn().mockRejectedValue(new Error("HTTP 500")),
    });
    expect(bad.failed).toBe(1);
    expect(await budgetAlertsSentToday(conn.db, NOW)).toEqual([]);
    const ok = await runBudgetAlerts({ ...deps, send: vi.fn().mockResolvedValue(undefined) });
    expect(ok.alerted).toEqual([70]);
  });

  it("con dos admins, si uno falla se reintenta solo a ese y nunca se manda dos veces al que ya lo tiene (R8-5)", async () => {
    await setSpend(1.5);
    const env = { ...ENV, ADMIN_EMAILS: "admin-a@ejemplo.test, admin-b@ejemplo.test" };
    const store = createDbBudgetAlertStore(conn.db);
    const deps = { store, spentUsd: async () => 1.5, env, now: NOW, logger };
    const first = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("HTTP 500"));
    const r1 = await runBudgetAlerts({ ...deps, send: first });
    expect(r1).toMatchObject({ sent: 1, failed: 1, complete: false });
    const second = vi.fn().mockResolvedValue(undefined);
    await runBudgetAlerts({ ...deps, send: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0].to).toBe("admin-b@ejemplo.test");
    const third = vi.fn().mockResolvedValue(undefined);
    await runBudgetAlerts({ ...deps, send: third });
    expect(third).not.toHaveBeenCalled();
  });

  it("una marca de R7-1 (sin destinatario) sigue valiendo para todos", async () => {
    await setSpend(1.5);
    await conn.db.insert(s.llmCalls).values({
      task: BUDGET_ALERT_TASK,
      model: "none",
      ok: true,
      costUsd: 0,
      label: "2026-12-10:70",
      createdAt: NOW,
    });
    const send = vi.fn();
    await runBudgetAlerts({
      store: createDbBudgetAlertStore(conn.db),
      spentUsd: async () => 1.5,
      env: ENV,
      now: NOW,
      logger,
      send,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("la revisión tras evaluar usa el memo: la segunda llamada no manda ni consulta (R8-5)", async () => {
    await setSpend(1.95);
    resetBudgetAlertMemoForTests();
    const send = vi.fn().mockResolvedValue(undefined);
    await checkBudgetAlertsAfterEvaluation({ db: conn.db, logger, env: ENV, now: NOW, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await budgetAlertsSentToday(conn.db, NOW)).toEqual([70, 85, 95]);
    // 95 % ya entregado a todos: ni siquiera consulta (se prueba con una base cerrada)
    await checkBudgetAlertsAfterEvaluation({
      db: {} as never,
      logger,
      env: ENV,
      now: new Date(NOW.getTime() + 3_600_000),
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    resetBudgetAlertMemoForTests();
  });

  it("la fila marca no suma llamadas ni USD en los reportes de gasto", async () => {
    await setSpend(1.5);
    await runBudgetAlerts({
      store: createDbBudgetAlertStore(conn.db),
      spentUsd: async () => 1.5,
      env: ENV,
      now: NOW,
      logger,
      send: vi.fn().mockResolvedValue(undefined),
    });
    const marks = await conn.db
      .select()
      .from(s.llmCalls)
      .where(eq(s.llmCalls.task, BUDGET_ALERT_TASK));
    expect(marks).toHaveLength(1);
    const spend = await spendLast24h(conn.db, () => NOW);
    expect(spend.calls).toBe(1);
    expect(spend.usd).toBeCloseTo(1.5);
  });
});
