import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lazo de la primera evaluación: con el proveedor caído, el corte de circuito frena el resto de las
 * ofertas (quedan en la cola para el cron). Todo con dobles: ninguna llamada real.
 */
const afterCallbacks: Array<() => Promise<void>> = [];
const evaluateJobNow = vi.fn();

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    afterCallbacks.push(fn);
  },
}));
vi.mock("@job-search-os/db", () => ({
  createDb: () => ({ db: {}, close: async () => {} }),
  requireDatabaseUrl: () => "postgres://ficticio.example/db",
}));
vi.mock("@job-search-os/pipeline", () => ({
  parsePoolLimits: () => ({ limits: {}, invalid: [] }),
}));
vi.mock("@/lib/llm-service", () => ({ serviceLlm: () => ({}) }));
vi.mock("@job-search-os/adapters", () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => logger };
  return {
    assignPoolToUser: vi.fn(),
    checkBudgetAlertsAfterEvaluation: async () => {},
    createLogger: () => logger,
    createPgQueue: () => ({}),
    evaluateJobNow: (...args: unknown[]) => evaluateJobNow(...args),
    hasPoolEvaluationActivity: vi.fn(),
    loadPoolEvalCap: vi.fn(),
    loadPoolEvalLimit: vi.fn(),
    safeDbError: () => "error",
  };
});

import { scheduleImmediateEvaluation } from "../lib/pool-reassign";

const nine = Array.from({ length: 9 }, (_, i) => `job-${i}`);

beforeEach(() => {
  afterCallbacks.length = 0;
  evaluateJobNow.mockReset();
});

describe("scheduleImmediateEvaluation con corte de circuito", () => {
  it("el lazo corta en cuanto el corte se abre: no sigue con las 9 ofertas", async () => {
    // Las primeras 5 llegan al proveedor (fallan); desde la sexta el corte está abierto
    evaluateJobNow.mockImplementation(async () =>
      evaluateJobNow.mock.calls.length <= 5
        ? { ran: true, outcome: { ok: false, error: "generation_failed:api_call:503" } }
        : { ran: false, reason: "breaker" },
    );
    scheduleImmediateEvaluation("00000000-0000-4000-8000-0000000000a1", nine);
    await afterCallbacks[0]!();
    expect(evaluateJobNow).toHaveBeenCalledTimes(6);
  });

  it("sin corte evalúa todas", async () => {
    evaluateJobNow.mockResolvedValue({ ran: true, outcome: { ok: true } });
    scheduleImmediateEvaluation("00000000-0000-4000-8000-0000000000a1", nine);
    await afterCallbacks[0]!();
    expect(evaluateJobNow).toHaveBeenCalledTimes(9);
  });
});
