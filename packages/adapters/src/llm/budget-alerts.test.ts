import { describe, expect, it, vi } from "vitest";
import { runBudgetAlerts, type BudgetAlertStore } from "./budget-alerts";

const NOW = new Date("2026-11-12T15:00:00.000Z");
const ENV = {
  LLM_DAILY_CAP_USD: "2",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Aviso <aviso@example.test>",
  AUTH_URL: "https://app.example.test",
  ADMIN_EMAILS: "admin-a@ejemplo.test, admin-b@ejemplo.test",
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function memoryStore(initial: string[] = []): BudgetAlertStore & { marks: Set<string> } {
  const marks = new Set(initial);
  return {
    marks,
    async sentThresholds(day) {
      return [...marks]
        .filter((m) => m.startsWith(`${day}:`))
        .map((m) => Number(m.split(":")[1]))
        .sort((a, b) => a - b);
    },
    async claim(day, t) {
      const key = `${day}:${t}`;
      if (marks.has(key)) return false;
      marks.add(key);
      return true;
    },
    async release(day, t) {
      marks.delete(`${day}:${t}`);
    },
  };
}

const run = (over: Partial<Parameters<typeof runBudgetAlerts>[0]>) =>
  runBudgetAlerts({
    store: memoryStore(),
    spentUsd: async () => 1.5,
    env: ENV,
    now: NOW,
    logger,
    send: vi.fn().mockResolvedValue(undefined),
    ...over,
  });

describe("runBudgetAlerts (R7-1)", () => {
  it("por debajo del 70 % no manda ni marca nada", async () => {
    const send = vi.fn();
    const store = memoryStore();
    const res = await run({ spentUsd: async () => 1.0, store, send });
    expect(res.alerted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(store.marks.size).toBe(0);
  });

  it("al pasar el 70 % manda un email a cada admin con la clave de idempotencia", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const res = await run({ send });
    expect(res).toMatchObject({ alerted: [70], sent: 2, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: "admin-a@ejemplo.test",
      idempotencyKey: "budget-alert:2026-11-12:70:0",
    });
    expect(send.mock.calls[1]![0].idempotencyKey).toBe("budget-alert:2026-11-12:70:1");
    expect(send.mock.calls[0]![0].text).toContain("https://app.example.test/settings/salud");
  });

  it("una segunda corrida el mismo día no repite el aviso", async () => {
    const store = memoryStore();
    const send = vi.fn().mockResolvedValue(undefined);
    await run({ store, send });
    const again = await run({ store, send });
    expect(again.alerted).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("al subir al 85 % avisa solo el umbral nuevo; al día siguiente vuelve a avisar", async () => {
    const store = memoryStore();
    const send = vi.fn().mockResolvedValue(undefined);
    await run({ store, send, spentUsd: async () => 1.5 });
    const second = await run({ store, send, spentUsd: async () => 1.75 });
    expect(second.alerted).toEqual([85]);
    const nextDay = await run({
      store,
      send,
      now: new Date("2026-11-13T09:00:00.000Z"),
      spentUsd: async () => 1.75,
    });
    expect(nextDay.alerted).toEqual([70, 85]);
  });

  it("si saltó varios umbrales manda un solo email por el más alto y marca todos", async () => {
    const store = memoryStore();
    const send = vi.fn().mockResolvedValue(undefined);
    const res = await run({ store, send, spentUsd: async () => 1.95 });
    expect(res.alerted).toEqual([70, 85, 95]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].subject).toContain("95");
    expect(store.marks.size).toBe(3);
  });

  it("si otra corrida reclamó el umbral, no manda", async () => {
    const store = memoryStore();
    store.claim = async () => false;
    const send = vi.fn();
    const res = await run({ store, send });
    expect(res.alerted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("si ningún envío sale, devuelve la marca y reintenta la próxima corrida", async () => {
    const store = memoryStore();
    const failing = vi.fn().mockRejectedValue(new Error("Resend POST /emails: HTTP 500 x@y.test"));
    const res = await run({ store, send: failing });
    expect(res).toMatchObject({ alerted: [], sent: 0, failed: 2 });
    expect(store.marks.size).toBe(0);
    const ok = vi.fn().mockResolvedValue(undefined);
    expect((await run({ store, send: ok })).alerted).toEqual([70]);
  });

  it("si sale al menos un envío, la marca queda", async () => {
    const store = memoryStore();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce(undefined);
    const res = await run({ store, send });
    expect(res).toMatchObject({ alerted: [70], sent: 1, failed: 1 });
    expect(store.marks.size).toBe(1);
  });

  it("el log de error no lleva el email ni el cuerpo de Resend", async () => {
    const error = vi.fn();
    await run({
      send: vi.fn().mockRejectedValue(new Error("HTTP 422 admin-a@ejemplo.test inválido")),
      logger: { info: vi.fn(), warn: vi.fn(), error },
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("ejemplo.test");
  });

  it.each([
    ["sin tope", { LLM_DAILY_CAP_USD: "0" }, "sin_tope"],
    ["tope inválido", { LLM_DAILY_CAP_USD: "abc" }, "tope_invalido"],
    ["sin key de Resend", { RESEND_API_KEY: "" }, "sin_resend"],
    ["sin remitente", { EMAIL_FROM: undefined }, "sin_resend"],
    ["sin admins", { ADMIN_EMAILS: " , " }, "sin_destinatarios"],
  ])("%s: no manda ni marca nada", async (_n, patch, skipped) => {
    const send = vi.fn();
    const store = memoryStore();
    const res = await run({ env: { ...ENV, ...patch }, send, store, spentUsd: async () => 99 });
    expect(res.skipped).toBe(skipped);
    expect(send).not.toHaveBeenCalled();
    expect(store.marks.size).toBe(0);
  });
});
