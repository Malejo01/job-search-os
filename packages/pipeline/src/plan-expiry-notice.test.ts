import { describe, expect, it } from "vitest";
import {
  buildPlanNoticeEmail,
  formatNoticeDate,
  isPlanNoticeDue,
  PLAN_NOTICE_DAILY_CAP_DEFAULT,
  PLAN_NOTICE_DAILY_CAP_MAX,
  planNoticeDailyCap,
  selectPlanNotices,
  type PlanNoticeCandidate,
} from "./plan-expiry-notice";
import { PRODUCT_NAME } from "./product";

const DAY = 86_400_000;
const NOW = new Date("2026-12-10T12:15:00Z");
const days = (n: number, from: Date = NOW) => new Date(from.getTime() + n * DAY);

function cand(over: Partial<PlanNoticeCandidate> = {}): PlanNoticeCandidate {
  return {
    userId: "u1",
    plan: "lista",
    planUntil: days(3),
    planSource: "pago",
    planNotifiedAt: null,
    ...over,
  };
}

describe("isPlanNoticeDue: a quién avisar (C4-1)", () => {
  it("avisa cuando quedan 3 días o menos y todavía no venció", () => {
    expect(isPlanNoticeDue(cand({ planUntil: days(3) }), NOW)).toBe(true);
    expect(isPlanNoticeDue(cand({ planUntil: days(2) }), NOW)).toBe(true);
    expect(isPlanNoticeDue(cand({ planUntil: new Date(NOW.getTime() + 60_000) }), NOW)).toBe(true);
  });

  it("no avisa con más de 3 días por delante", () => {
    expect(isPlanNoticeDue(cand({ planUntil: days(4) }), NOW)).toBe(false);
    expect(isPlanNoticeDue(cand({ planUntil: days(20) }), NOW)).toBe(false);
  });

  it("no avisa si ya venció (pasó al gratis) ni justo en el instante de vencer", () => {
    expect(isPlanNoticeDue(cand({ planUntil: NOW }), NOW)).toBe(false);
    expect(isPlanNoticeDue(cand({ planUntil: days(-1) }), NOW)).toBe(false);
  });

  it("no avisa al plan gratis, a un plan desconocido ni a uno sin fecha de fin", () => {
    expect(isPlanNoticeDue(cand({ plan: "gratis", planUntil: days(1) }), NOW)).toBe(false);
    expect(isPlanNoticeDue(cand({ plan: "premium", planUntil: days(1) }), NOW)).toBe(false);
    expect(isPlanNoticeDue(cand({ plan: null, planUntil: days(1) }), NOW)).toBe(false);
    expect(isPlanNoticeDue(cand({ planUntil: null }), NOW)).toBe(false);
  });

  it("avisa también a quien tiene beca", () => {
    expect(isPlanNoticeDue(cand({ planSource: "beca" }), NOW)).toBe(true);
  });

  it("no repite el aviso de un mismo vencimiento", () => {
    // Vence en 2,5 días: la ventana de aviso se abrió hace medio día
    const until = days(2.5);
    // Avisada hace un rato, dentro de la ventana de ese vencimiento
    expect(isPlanNoticeDue(cand({ planUntil: until, planNotifiedAt: days(-1 / 24) }), NOW)).toBe(
      false,
    );
    // Avisada justo cuando se abrió la ventana (3 días antes del fin)
    expect(isPlanNoticeDue(cand({ planUntil: until, planNotifiedAt: days(-0.5) }), NOW)).toBe(
      false,
    );
  });

  it("avisa de nuevo cuando renovó: el aviso viejo era de otro vencimiento", () => {
    // Venció el 13/12, la avisamos el 10/12 y renovó 30 días: ahora vence el 12/1
    const renewedUntil = days(33);
    const later = days(31); // faltan 2 días para el 12/1
    expect(isPlanNoticeDue(cand({ planUntil: renewedUntil, planNotifiedAt: NOW }), later)).toBe(
      true,
    );
  });

  it("sigue siendo idempotente si el cron corre dos veces seguidas", () => {
    const first = selectPlanNotices([cand()], { now: NOW, limit: 10 });
    expect(first).toHaveLength(1);
    // Después del envío se guarda planNotifiedAt = now; la segunda corrida no la elige
    const second = selectPlanNotices([cand({ planNotifiedAt: NOW })], {
      now: new Date(NOW.getTime() + 60_000),
      limit: 10,
    });
    expect(second).toHaveLength(0);
  });
});

describe("selectPlanNotices: orden y tope", () => {
  const many = [
    cand({ userId: "c", planUntil: days(3) }),
    cand({ userId: "a", planUntil: days(1) }),
    cand({ userId: "b", planUntil: days(1) }),
    cand({ userId: "d", planUntil: days(10) }),
    cand({ userId: "e", planUntil: days(2), planNotifiedAt: days(-0.5) }),
  ];

  it("filtra a las que no corresponden y ordena por la que vence antes", () => {
    const picked = selectPlanNotices(many, { now: NOW, limit: 10 });
    expect(picked.map((c) => c.userId)).toEqual(["a", "b", "c"]);
  });

  it("respeta el tope y manda primero las más urgentes", () => {
    expect(selectPlanNotices(many, { now: NOW, limit: 2 }).map((c) => c.userId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("con tope 0, negativo o no entero no elige a nadie", () => {
    expect(selectPlanNotices(many, { now: NOW, limit: 0 })).toEqual([]);
    expect(selectPlanNotices(many, { now: NOW, limit: -3 })).toEqual([]);
    expect(selectPlanNotices(many, { now: NOW, limit: Number.NaN })).toEqual([]);
  });

  it("no elige dos veces a la misma persona", () => {
    const dup = [cand({ userId: "x" }), cand({ userId: "x", planUntil: days(1) })];
    expect(selectPlanNotices(dup, { now: NOW, limit: 10 })).toHaveLength(1);
  });

  it("no modifica la lista de entrada", () => {
    const copy = [...many];
    selectPlanNotices(many, { now: NOW, limit: 10 });
    expect(many).toEqual(copy);
  });
});

describe("planNoticeDailyCap: tope diario de emails", () => {
  it("usa el default sin variable o con un valor inválido", () => {
    expect(planNoticeDailyCap(undefined)).toBe(PLAN_NOTICE_DAILY_CAP_DEFAULT);
    expect(planNoticeDailyCap("")).toBe(PLAN_NOTICE_DAILY_CAP_DEFAULT);
    expect(planNoticeDailyCap("muchos")).toBe(PLAN_NOTICE_DAILY_CAP_DEFAULT);
    expect(planNoticeDailyCap("-5")).toBe(PLAN_NOTICE_DAILY_CAP_DEFAULT);
    expect(planNoticeDailyCap("2.5")).toBe(PLAN_NOTICE_DAILY_CAP_DEFAULT);
  });

  it("acepta un entero y nunca pasa del máximo (queda margen en los 100 diarios de Resend)", () => {
    expect(planNoticeDailyCap("10")).toBe(10);
    expect(planNoticeDailyCap("0")).toBe(0);
    expect(planNoticeDailyCap("5000")).toBe(PLAN_NOTICE_DAILY_CAP_MAX);
    expect(PLAN_NOTICE_DAILY_CAP_MAX).toBeLessThan(100);
  });
});

describe("formatNoticeDate", () => {
  it("usa la fecha de Argentina (UTC−3), no la de UTC", () => {
    // 01:00 UTC del 27/12 son las 22:00 del 26/12 en Argentina
    expect(formatNoticeDate(new Date("2026-12-27T01:00:00Z"))).toBe("26 de diciembre");
    expect(formatNoticeDate(new Date("2026-12-27T04:00:00Z"))).toBe("27 de diciembre");
    expect(formatNoticeDate(new Date("2027-01-05T15:00:00Z"))).toBe("5 de enero");
  });
});

describe("buildPlanNoticeEmail: el texto del aviso", () => {
  const base = {
    displayName: "Ana Pérez",
    until: new Date("2026-12-13T15:00:00Z"),
    paymentUrl: "https://mpago.la/abc",
    settingsUrl: "https://app.example/settings#tu-plan",
    contactEmail: "hola@example.com",
    becado: false,
  };

  it("lleva la fecha, el link de pago y qué pasa si no renueva", () => {
    const { subject, text } = buildPlanNoticeEmail(base);
    expect(subject).toContain("13 de diciembre");
    expect(text).toContain("13 de diciembre");
    expect(text).toContain("https://mpago.la/abc");
    expect(text).toMatch(/plan gratis/);
    expect(text).toMatch(/no perd[ée]s nada|no perd[ée]s ning[uú]n dato/i);
    expect(text).toContain(PRODUCT_NAME);
    expect(text).toContain("Ana");
    expect(text).not.toContain("Pérez");
  });

  it("es texto simple, sin HTML", () => {
    const { text } = buildPlanNoticeEmail(base);
    expect(text).not.toMatch(/<[a-z][^>]*>/i);
  });

  it("sin link de pago pide la renovación por contacto o por Ajustes, sin inventar un link", () => {
    const { text } = buildPlanNoticeEmail({ ...base, paymentUrl: null });
    expect(text).not.toContain("mpago.la");
    expect(text).toContain("hola@example.com");
    expect(text).toContain("https://app.example/settings#tu-plan");
  });

  it("sin contacto ni link de pago manda a Ajustes", () => {
    const { text } = buildPlanNoticeEmail({ ...base, paymentUrl: null, contactEmail: null });
    expect(text).toContain("https://app.example/settings#tu-plan");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });

  it("si es una beca lo dice distinto", () => {
    const { subject, text } = buildPlanNoticeEmail({ ...base, becado: true });
    expect(subject).toMatch(/beca/i);
    expect(text).toMatch(/beca/i);
  });

  it("sin nombre saluda sin nombre y no rompe con nombres raros", () => {
    expect(buildPlanNoticeEmail({ ...base, displayName: "" }).text.startsWith("Hola,")).toBe(true);
    expect(buildPlanNoticeEmail({ ...base, displayName: "   " }).text.startsWith("Hola,")).toBe(
      true,
    );
    const long = buildPlanNoticeEmail({ ...base, displayName: "x".repeat(300) }).text;
    expect(long.split("\n")[0]!.length).toBeLessThan(80);
  });

  it("no promete garantía ni reintegros", () => {
    const { text } = buildPlanNoticeEmail(base);
    expect(text).not.toMatch(/garant|reintegr|devoluci/i);
  });
});
