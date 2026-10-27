import { describe, expect, it } from "vitest";
import {
  cvChatCapNotice,
  cvChatCapReason,
  cvChatDailyCapUsd,
  cvChatEnabled,
  cvChatWindows,
  type CvChatCapInput,
} from "./limits";

const ok: CvChatCapInput = {
  turns: 3,
  conversationCostUsd: 0.05,
  cvThisMonth: 0,
  cvPerMonth: 1,
  dailySpendUsd: 0.2,
  dailyCapUsd: 1,
};

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
    for (const cap of ["mes", "turnos", "conversacion", "global"] as const) {
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
