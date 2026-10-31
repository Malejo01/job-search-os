import { describe, expect, it, vi } from "vitest";
import {
  MAX_CONSECUTIVE_FAILURES,
  runPlanExpiryNotices,
  startOfUtcDay,
  type NoticeCandidate,
  type NoticeStore,
} from "./plan-expiry-notices";

/** Lógica de la corrida con una base falsa (el store real se prueba en el test de integración). */
const DAY = 86_400_000;
const NOW = new Date("2026-12-10T12:15:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);
const ENV = {
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "AfinIA <aviso@example.test>",
  AUTH_URL: "https://app.example.test",
  MP_LINK_LISTA: "https://mpago.la/abc",
  CONTACT_EMAIL: "hola@example.test",
};

function cand(id: string, over: Partial<NoticeCandidate> = {}): NoticeCandidate {
  return {
    userId: `u-${id}`,
    email: `${id}@ejemplo.test`,
    displayName: `Persona ${id}`,
    plan: "lista",
    planUntil: days(2),
    planSource: "pago",
    planNotifiedAt: null,
    ...over,
  };
}

function fakeStore(
  candidates: NoticeCandidate[],
  opts: { marked?: number; claimable?: (c: NoticeCandidate) => boolean } = {},
) {
  const calls = { load: 0, claim: [] as string[], release: [] as string[] };
  const store: NoticeStore = {
    async loadCandidates() {
      calls.load++;
      return candidates;
    },
    async countMarkedSince() {
      return opts.marked ?? 0;
    },
    async claim(c) {
      calls.claim.push(c.userId);
      return opts.claimable ? opts.claimable(c) : true;
    },
    async release(c) {
      calls.release.push(c.userId);
    },
  };
  return { store, calls };
}

function logger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const mk = (level: string) => (obj: Record<string, unknown>, msg: string) =>
    lines.push({ level, obj, msg });
  return { lines, log: { info: mk("info"), warn: mk("warn"), error: mk("error") } };
}

describe("runPlanExpiryNotices (C4-1)", () => {
  it("sin RESEND_API_KEY o sin EMAIL_FROM no manda, no lee la base y no marca a nadie", async () => {
    for (const env of [{ ...ENV, RESEND_API_KEY: undefined }, { ...ENV, EMAIL_FROM: "  " }, {}]) {
      const { store, calls } = fakeStore([cand("a")]);
      const send = vi.fn();
      const { log } = logger();
      const res = await runPlanExpiryNotices({ store, env, now: NOW, logger: log, send });
      expect(res).toMatchObject({ ok: true, skipped: "sin_resend", sent: 0 });
      expect(send).not.toHaveBeenCalled();
      expect(calls.load).toBe(0);
      expect(calls.claim).toEqual([]);
    }
  });

  it("en producción sin URL base no manda nada", async () => {
    const { store, calls } = fakeStore([cand("a")]);
    const send = vi.fn();
    const res = await runPlanExpiryNotices({
      store,
      env: { ...ENV, AUTH_URL: undefined, NODE_ENV: "production" },
      now: NOW,
      logger: logger().log,
      send,
    });
    expect(res.skipped).toBe("sin_url");
    expect(send).not.toHaveBeenCalled();
    expect(calls.claim).toEqual([]);
  });

  it("manda un solo email por persona, en texto simple, con la fecha y el link de pago", async () => {
    const { store, calls } = fakeStore([cand("a"), cand("b", { planUntil: days(1) })]);
    const send = vi.fn().mockResolvedValue(undefined);
    const res = await runPlanExpiryNotices({
      store,
      env: ENV,
      now: NOW,
      logger: logger().log,
      send,
    });
    expect(res).toMatchObject({ ok: true, due: 2, sent: 2, failed: 0, raced: 0 });
    // La que vence antes va primero
    expect(calls.claim).toEqual(["u-b", "u-a"]);
    const [params, apiKey] = send.mock.calls[0]!;
    expect(apiKey).toBe("re_test");
    expect(params).toMatchObject({ to: "b@ejemplo.test", from: ENV.EMAIL_FROM });
    expect(params.html).toBeUndefined();
    expect(params.text).toContain("https://mpago.la/abc");
    expect(params.text).toContain("11 de diciembre");
    expect(params.text).toContain("https://app.example.test/settings#tu-plan");
  });

  it("no manda a quien no corresponde (gratis, vencido, sin fecha, más de 3 días, ya avisado)", async () => {
    const { store, calls } = fakeStore([
      cand("gratis", { plan: "gratis" }),
      cand("vencido", { planUntil: days(-1) }),
      cand("sinfecha", { planUntil: null }),
      cand("lejos", { planUntil: days(10) }),
      cand("avisado", { planUntil: days(2), planNotifiedAt: days(-0.2) }),
    ]);
    const send = vi.fn();
    const res = await runPlanExpiryNotices({
      store,
      env: ENV,
      now: NOW,
      logger: logger().log,
      send,
    });
    expect(res).toMatchObject({ due: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(calls.claim).toEqual([]);
  });

  it("si otra corrida ya reclamó a la persona, no manda", async () => {
    const { store } = fakeStore([cand("a"), cand("b")], { claimable: (c) => c.userId !== "u-a" });
    const send = vi.fn().mockResolvedValue(undefined);
    const res = await runPlanExpiryNotices({
      store,
      env: ENV,
      now: NOW,
      logger: logger().log,
      send,
    });
    expect(res).toMatchObject({ due: 2, sent: 1, raced: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].to).toBe("b@ejemplo.test");
  });

  it("respeta el tope diario descontando lo ya marcado hoy", async () => {
    const people = ["a", "b", "c", "d"].map((id, i) => cand(id, { planUntil: days(1 + i / 10) }));
    const { store } = fakeStore(people, { marked: 8 });
    const send = vi.fn().mockResolvedValue(undefined);
    const res = await runPlanExpiryNotices({
      store,
      env: { ...ENV, PLAN_NOTICE_DAILY_CAP: "10" },
      now: NOW,
      logger: logger().log,
      send,
    });
    expect(res).toMatchObject({ sent: 2, capLeft: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("con el tope agotado no lee candidatos ni manda", async () => {
    const { store, calls } = fakeStore([cand("a")], { marked: 30 });
    const send = vi.fn();
    const res = await runPlanExpiryNotices({
      store,
      env: ENV,
      now: NOW,
      logger: logger().log,
      send,
    });
    expect(res.skipped).toBe("tope_diario");
    expect(calls.load).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("si el envío falla devuelve la marca para reintentar mañana y no loguea el email", async () => {
    const { store, calls } = fakeStore([cand("a"), cand("b")]);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Resend POST /emails: HTTP 422 a@ejemplo.test inválido"))
      .mockResolvedValueOnce(undefined);
    const { lines, log } = logger();
    const res = await runPlanExpiryNotices({ store, env: ENV, now: NOW, logger: log, send });
    expect(res).toMatchObject({ sent: 1, failed: 1 });
    expect(calls.release).toEqual(["u-a"]);
    const failure = lines.find((l) => l.msg.includes("no se pudo mandar"));
    expect(failure?.obj).toEqual({ user_id: "u-a", status: 422 });
    expect(JSON.stringify(lines)).not.toContain("ejemplo.test");
    expect(JSON.stringify(lines)).not.toContain("Persona");
  });

  it("corta la corrida después de varios fallos seguidos", async () => {
    const many = Array.from({ length: MAX_CONSECUTIVE_FAILURES + 3 }, (_, i) =>
      cand(String(i), { planUntil: days(1 + i / 100) }),
    );
    const { store, calls } = fakeStore(many);
    const send = vi.fn().mockRejectedValue(new Error("HTTP 500"));
    const res = await runPlanExpiryNotices({
      store,
      env: ENV,
      now: NOW,
      logger: logger().log,
      send,
    });
    expect(res.failed).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(calls.release).toHaveLength(MAX_CONSECUTIVE_FAILURES);
  });

  it("sin link de pago válido igual avisa, sin inventar un link", async () => {
    const { store } = fakeStore([cand("a")]);
    const send = vi.fn().mockResolvedValue(undefined);
    await runPlanExpiryNotices({
      store,
      env: { ...ENV, MP_LINK_LISTA: "https://evil.example/mpago.la" },
      now: NOW,
      logger: logger().log,
      send,
    });
    const text = send.mock.calls[0]![0].text as string;
    expect(text).not.toContain("evil.example");
    expect(text).toContain("hola@example.test");
  });
});

describe("startOfUtcDay", () => {
  it("devuelve las 00:00 UTC del día", () => {
    expect(startOfUtcDay(new Date("2026-12-10T23:59:59Z")).toISOString()).toBe(
      "2026-12-10T00:00:00.000Z",
    );
  });
});
