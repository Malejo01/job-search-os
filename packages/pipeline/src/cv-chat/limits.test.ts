import { describe, expect, it } from "vitest";
import { CV_CHAT_BETA_LIMITS } from "../plans";
import {
  cvChatCapNotice,
  cvChatCapReason,
  cvChatDailyCapUsd,
  cvChatBetaCvPerMonth,
  cvChatEnabled,
  cvChatMonthTurnsReason,
  cvChatStartCapReason,
  cvChatWindows,
  type CvChatCapInput,
} from "./limits";

const ok: CvChatCapInput = {
  turns: 3,
  conversationCostUsd: 0.05,
  cvThisMonth: 0,
  cvPerMonth: 1,
  userInterviewSpendUsd: 0.05,
  dailySpendUsd: 0.2,
  dailyCapUsd: 1,
};

describe("topes mensuales de la beta (C2-1)", () => {
  it("CV_CHAT_BETA_LIMITS: 3 CV y 40 turnos de entrevista por mes", () => {
    expect(CV_CHAT_BETA_LIMITS).toEqual({ cvPerMonth: 3, interviewTurnsPerMonth: 40 });
  });
  it("CV por mes: el plan gratis tiene 3 en la beta, un plan que da más conserva el suyo", () => {
    expect(cvChatBetaCvPerMonth(1)).toBe(3);
    expect(cvChatBetaCvPerMonth(3)).toBe(3);
    expect(cvChatBetaCvPerMonth(5)).toBe(5);
    expect(cvChatBetaCvPerMonth(Number.NaN)).toBe(3);
    expect(cvChatBetaCvPerMonth(Number.POSITIVE_INFINITY)).toBe(3);
    expect(cvChatBetaCvPerMonth(0)).toBe(3);
  });
  it("turnos por mes: se llega al tope con 40 y falla cerrado ante un número inválido", () => {
    expect(cvChatMonthTurnsReason(0)).toBeNull();
    expect(cvChatMonthTurnsReason(39)).toBeNull();
    expect(cvChatMonthTurnsReason(40)).toBe("turnos_mes");
    expect(cvChatMonthTurnsReason(41)).toBe("turnos_mes");
    expect(cvChatMonthTurnsReason(Number.NaN)).toBe("turnos_mes");
    expect(cvChatMonthTurnsReason(-1)).toBe("turnos_mes");
    expect(cvChatMonthTurnsReason(10, 10)).toBe("turnos_mes");
    expect(cvChatMonthTurnsReason(1, Number.NaN)).toBe("turnos_mes");
  });
  it("el mensaje del tope mensual de turnos es claro y no promete lo que no hay", () => {
    const n = cvChatCapNotice("turnos_mes");
    expect(n.message).toContain("este mes");
    expect(n.message).toContain("a mano");
    expect(n.message).not.toMatch(/ATS|filtros/i);
    expect(n.links.length).toBeGreaterThan(0);
  });
});

describe("cvChatCapReason", () => {
  it("sin topes alcanzados devuelve null", () => {
    expect(cvChatCapReason(ok)).toBeNull();
  });
  it("mes: según el plan (gratis 1, pago 5)", () => {
    expect(cvChatCapReason({ ...ok, cvThisMonth: 1 })).toBe("mes");
    expect(cvChatCapReason({ ...ok, cvThisMonth: 4, cvPerMonth: 5 })).toBeNull();
    expect(cvChatCapReason({ ...ok, cvThisMonth: 5, cvPerMonth: 5 })).toBe("mes");
  });
  it("turnos: 25", () => {
    expect(cvChatCapReason({ ...ok, turns: 24 })).toBeNull();
    expect(cvChatCapReason({ ...ok, turns: 25 })).toBe("turnos");
  });
  it("conversación: USD 0,15", () => {
    expect(cvChatCapReason({ ...ok, conversationCostUsd: 0.149 })).toBeNull();
    expect(cvChatCapReason({ ...ok, conversationCostUsd: 0.15 })).toBe("conversacion");
  });
  it("por persona y día: USD 0,30 de entrevistas, de todas sus charlas", () => {
    expect(cvChatCapReason({ ...ok, userInterviewSpendUsd: 0.299 })).toBeNull();
    expect(cvChatCapReason({ ...ok, userInterviewSpendUsd: 0.3 })).toBe("usuario");
    expect(cvChatCapReason({ ...ok, userInterviewSpendUsd: Number.NaN })).toBe("usuario");
  });
  it("charlas nuevas: hasta 5 por día", () => {
    expect(cvChatStartCapReason(0)).toBeNull();
    expect(cvChatStartCapReason(4)).toBeNull();
    expect(cvChatStartCapReason(5)).toBe("inicios");
    expect(cvChatStartCapReason(Number.NaN)).toBe("inicios");
  });
  it("global diario", () => {
    expect(cvChatCapReason({ ...ok, dailySpendUsd: 1 })).toBe("global");
    expect(cvChatCapReason({ ...ok, dailyCapUsd: 0 })).toBe("global");
  });
  it("falla cerrado con números rotos", () => {
    expect(cvChatCapReason({ ...ok, cvPerMonth: Number.NaN })).toBe("mes");
    expect(cvChatCapReason({ ...ok, turns: Number.NaN })).toBe("turnos");
    expect(cvChatCapReason({ ...ok, conversationCostUsd: Number.NaN })).toBe("conversacion");
    expect(cvChatCapReason({ ...ok, dailySpendUsd: Number.NaN })).toBe("global");
    expect(cvChatCapReason({ ...ok, dailyCapUsd: Number.NaN })).toBe("global");
  });
});

describe("mensaje fijo", () => {
  it("cada tope trae un texto fijo y los links a las pantallas", () => {
    for (const cap of ["mes", "turnos", "conversacion", "usuario", "inicios", "global"] as const) {
      const n = cvChatCapNotice(cap);
      expect(n.message.length).toBeGreaterThan(20);
      expect(n.links.map((l) => l.href)).toContain("/settings/historial");
    }
    expect(cvChatCapNotice("mes").message).not.toBe(cvChatCapNotice("global").message);
  });
});

describe("variables", () => {
  it("CV_CHAT_DAILY_CAP_USD: 1,00 por defecto, 0 si está mal", () => {
    expect(cvChatDailyCapUsd({})).toBe(1);
    expect(cvChatDailyCapUsd({ CV_CHAT_DAILY_CAP_USD: "0.5" })).toBe(0.5);
    expect(cvChatDailyCapUsd({ CV_CHAT_DAILY_CAP_USD: "mucho" })).toBe(0);
    expect(cvChatDailyCapUsd({ CV_CHAT_DAILY_CAP_USD: "-1" })).toBe(0);
  });
  it("CV_CHAT_ENABLED: admin / all / apagado", () => {
    expect(cvChatEnabled({ CV_CHAT_ENABLED: "all" }, false)).toBe(true);
    expect(cvChatEnabled({ CV_CHAT_ENABLED: "admin" }, true)).toBe(true);
    expect(cvChatEnabled({ CV_CHAT_ENABLED: "admin" }, false)).toBe(false);
    expect(cvChatEnabled({}, true)).toBe(false);
    expect(cvChatEnabled({ CV_CHAT_ENABLED: "true" }, true)).toBe(false);
  });
  it("ventanas con now inyectado", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const w = cvChatWindows(now);
    expect(w.daySince.toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(w.monthSince.toISOString()).toBe("2026-09-26T12:00:00.000Z");
  });
});
