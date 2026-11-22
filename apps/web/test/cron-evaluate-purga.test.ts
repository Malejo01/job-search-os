import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runEvaluateWorker: vi.fn(),
  purgeExpired: vi.fn(),
  purgePool: vi.fn(),
  runBudgetAlerts: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock("@job-search-os/db", () => ({
  createDb: () => ({ db: {}, close: mocks.close }),
  requireDatabaseUrl: () => "postgres://example.invalid/db",
}));
vi.mock("@/lib/llm-service", () => ({ serviceLlm: () => ({}) }));
vi.mock("@job-search-os/adapters", () => ({
  buildEvaluateCronResponse: () => ({ ok: true }),
  checkBearerSecret: () => true,
  failedOutcomes: () => [],
  createDbBudgetAlertStore: () => ({}),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createPgQueue: () => ({}),
  EVALUATE_BUDGET_MS: 1000,
  parseLogDays: () => 30,
  purgeExpired: mocks.purgeExpired,
  purgePool: mocks.purgePool,
  runBudgetAlerts: mocks.runBudgetAlerts,
  runEvaluateWorker: mocks.runEvaluateWorker,
  safeDbError: (e: unknown) => String(e),
  spentLast24hUsd: () => 0,
}));

import { GET } from "../app/api/cron/evaluate/route";

const call = () => GET(new Request("https://app.example/api/cron/evaluate"));

describe("GET /api/cron/evaluate: la purga de retención", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.close.mockResolvedValue(undefined);
    mocks.purgeExpired.mockResolvedValue({ tokens: 1, llmCalls: 2, queue: 3, rejections: 4 });
    mocks.purgePool.mockResolvedValue({ jobs: 5 });
    mocks.runBudgetAlerts.mockResolvedValue({ alerted: [] });
  });

  it("con el worker en orden, purga y responde el total", async () => {
    mocks.runEvaluateWorker.mockResolvedValue({ outcomes: [], stopped: "done" });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ purged: 10, purgedPool: 5 });
  });

  it("aunque el worker lance, la purga de retención y la del pool corren", async () => {
    mocks.runEvaluateWorker.mockRejectedValue(new Error("worker caído"));

    const res = await call();

    expect(mocks.purgeExpired).toHaveBeenCalledTimes(1);
    expect(mocks.purgePool).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "worker falló" });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("si la purga falla, el cron no se rompe", async () => {
    mocks.runEvaluateWorker.mockResolvedValue({ outcomes: [], stopped: "done" });
    mocks.purgeExpired.mockRejectedValue(new Error("purga caída"));

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ purged: null });
  });
});
