import { describe, expect, it, vi } from "vitest";
import {
  budgetAlertRecipientId,
  runBudgetAlerts,
  type BudgetAlertMarks,
  type BudgetAlertStore,
} from "./budget-alerts";

const NOW = new Date("2026-11-12T15:00:00.000Z");
const ENV = {
  LLM_DAILY_CAP_USD: "2",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Aviso <aviso@example.test>",
  AUTH_URL: "https://app.example.test",
  ADMIN_EMAILS: "admin-a@ejemplo.test, admin-b@ejemplo.test",
};
const A = budgetAlertRecipientId("admin-a@ejemplo.test");
const B = budgetAlertRecipientId("admin-b@ejemplo.test");
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Marcas en memoria como `day:umbral:id` (o `day:umbral` para las de R7-1). */
function memoryStore(initial: string[] = []): BudgetAlertStore & { marks: Set<string> } {
  const marks = new Set(initial);
  const ops: BudgetAlertMarks = {
    async sentMarks(day) {
      return [...marks]
        .filter((m) => m.startsWith(`${day}:`))
        .map((m) => {
          const [, t, rid] = m.split(":");
          return { recipientId: rid ?? null, threshold: Number(t) };
        });
    },
    async mark(day, thresholds, rid) {
      for (const t of thresholds) marks.add(`${day}:${t}:${rid}`);
    },
  };
  let chain: Promise<unknown> = Promise.resolve();
  return {
    marks,
    ...ops,
    runExclusive(_day, fn) {
      const next = chain.then(() => fn(ops));
      chain = next.catch(() => {});
      return next;
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

describe("runBudgetAlerts (R7-1, R8-5)", () => {
  it("por debajo del 70 % no manda ni marca nada", async () => {
    const send = vi.fn();
    const store = memoryStore();
    const res = await run({ spentUsd: async () => 1.0, store, send });
    expect(res.alerted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(store.marks.size).toBe(0);
  });

  it("al pasar el 70 % manda un email a cada admin con una clave por destinatario (hash, no índice)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const res = await run({ send });
    expect(res).toMatchObject({ alerted: [70], sent: 2, failed: 0, complete: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: "admin-a@ejemplo.test",
      idempotencyKey: `budget-alert:2026-11-12:70:${A}`,
    });
    expect(send.mock.calls[1]![0].idempotencyKey).toBe(`budget-alert:2026-11-12:70:${B}`);
    expect(send.mock.calls[0]![0].text).toContain("https://app.example.test/settings/salud");
  });

  it("la clave de un admin no cambia si cambia el orden de ADMIN_EMAILS", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await run({
      send,
      env: { ...ENV, ADMIN_EMAILS: "admin-b@ejemplo.test, admin-a@ejemplo.test" },
    });
    const byTo = Object.fromEntries(send.mock.calls.map((c) => [c[0].to, c[0].idempotencyKey]));
    expect(byTo["admin-a@ejemplo.test"]).toBe(`budget-alert:2026-11-12:70:${A}`);
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

  it("si saltó varios umbrales manda un solo email por destinatario, por el más alto, y anota todos", async () => {
    const store = memoryStore();
    const send = vi.fn().mockResolvedValue(undefined);
    const res = await run({ store, send, spentUsd: async () => 1.95 });
    expect(res.alerted).toEqual([70, 85, 95]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].subject).toContain("95");
    expect(store.marks.size).toBe(6);
  });

  it("si un envío falla, no se anota y la próxima corrida reintenta solo a ese destinatario", async () => {
    const store = memoryStore();
    const send1 = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Resend POST /emails: HTTP 500 x@y.test"));
    const first = await run({ store, send: send1 });
    expect(first).toMatchObject({ alerted: [70], sent: 1, failed: 1, complete: false });
    expect(store.marks.has(`2026-11-12:70:${A}`)).toBe(true);
    expect(store.marks.has(`2026-11-12:70:${B}`)).toBe(false);

    const send2 = vi.fn().mockResolvedValue(undefined);
    const second = await run({ store, send: send2 });
    expect(second).toMatchObject({ sent: 1, failed: 0, complete: true });
    expect(send2).toHaveBeenCalledTimes(1);
    expect(send2.mock.calls[0]![0].to).toBe("admin-b@ejemplo.test");
  });

  it("si fallan todos, no queda ninguna marca y se reintenta a todos", async () => {
    const store = memoryStore();
    const failing = vi.fn().mockRejectedValue(new Error("HTTP 500"));
    const res = await run({ store, send: failing });
    expect(res).toMatchObject({ alerted: [], sent: 0, failed: 2, complete: false });
    expect(store.marks.size).toBe(0);
    const ok = vi.fn().mockResolvedValue(undefined);
    expect((await run({ store, send: ok })).alerted).toEqual([70]);
    expect(ok).toHaveBeenCalledTimes(2);
  });

  it("no hay marca sin envío: la marca se anota después de mandar", async () => {
    const store = memoryStore();
    const send = vi.fn().mockImplementation(async () => {
      expect(store.marks.size).toBe(0); // al mandar, todavía no hay nada anotado
    });
    await run({ store, send, env: { ...ENV, ADMIN_EMAILS: "admin-a@ejemplo.test" } });
    expect(store.marks.size).toBe(1);
  });

  it("si el proceso muere entre mandar y anotar, el reintento usa la misma clave de Resend", async () => {
    const store = memoryStore();
    store.runExclusive = async (_d, fn) =>
      fn({
        sentMarks: store.sentMarks,
        mark: async () => {
          throw new Error("conexión caída");
        },
      });
    const send = vi.fn().mockResolvedValue(undefined);
    const env = { ...ENV, ADMIN_EMAILS: "admin-a@ejemplo.test" };
    const first = await run({ store, send, env });
    expect(first.complete).toBe(false);
    const retry = vi.fn().mockResolvedValue(undefined);
    await run({ store: memoryStore(), send: retry, env });
    expect(retry.mock.calls[0]![0].idempotencyKey).toBe(send.mock.calls[0]![0].idempotencyKey);
  });

  it("una marca vieja de R7-1 (sin destinatario) vale para todos", async () => {
    const send = vi.fn();
    const res = await run({ store: memoryStore(["2026-11-12:70"]), send });
    expect(res.alerted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("dos corridas a la vez no mandan dos veces", async () => {
    const store = memoryStore();
    const send = vi.fn().mockResolvedValue(undefined);
    await Promise.all([run({ store, send }), run({ store, send })]);
    expect(send).toHaveBeenCalledTimes(2); // un email por admin, no cuatro
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
