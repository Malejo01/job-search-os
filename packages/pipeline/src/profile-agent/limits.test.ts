import { describe, expect, it } from "vitest";
import {
  PROFILE_AGENT_MAX_GAP_TURNS,
  PROFILE_AGENT_MAX_READS_PER_DAY,
  PROFILE_AGENT_READS_PER_MONTH,
  profileAgentCapNotice,
  profileAgentCapReason,
  profileAgentDailyCapUsd,
  profileAgentReadsPerMonth,
  profileAgentRowCostUsd,
  profileAgentWindows,
  type ProfileAgentCap,
  type ProfileAgentCapInput,
} from "./limits";

const ok: ProfileAgentCapInput = {
  stage: "gaps",
  exempt: false,
  readsThisMonth: 0,
  readsPerMonth: 3,
  readsToday: 0,
  gapTurns: 2,
  flowCostUsd: 0.05,
  userSpendTodayUsd: 0.05,
  dailySpendUsd: 0.2,
  dailyCapUsd: 1,
};

describe("cupo de lecturas (decisión 5)", () => {
  it("3 gratis y 10 pago", () => {
    expect(PROFILE_AGENT_READS_PER_MONTH).toEqual({ free: 3, paid: 10 });
    expect(profileAgentReadsPerMonth("free")).toBe(3);
    expect(profileAgentReadsPerMonth("paid")).toBe(10);
  });
  it("la lectura 4 del plan gratis se frena; la 3 pasa", () => {
    const read = { ...ok, stage: "read" as const, readsPerMonth: 3 };
    expect(profileAgentCapReason({ ...read, readsThisMonth: 2 })).toBeNull();
    expect(profileAgentCapReason({ ...read, readsThisMonth: 3 })).toBe("lecturas_mes");
  });
  it("sin tope para admin y testers, pero los USD rigen igual", () => {
    const read = { ...ok, stage: "read" as const, exempt: true };
    expect(profileAgentCapReason({ ...read, readsThisMonth: 99, readsToday: 99 })).toBeNull();
    expect(profileAgentCapReason({ ...read, userSpendTodayUsd: 0.5 })).toBe("usuario");
    expect(profileAgentCapReason({ ...read, dailySpendUsd: 1 })).toBe("global");
  });
  it("lecturas por día", () => {
    const read = { ...ok, stage: "read" as const };
    expect(
      profileAgentCapReason({ ...read, readsToday: PROFILE_AGENT_MAX_READS_PER_DAY - 1 }),
    ).toBeNull();
    expect(profileAgentCapReason({ ...read, readsToday: PROFILE_AGENT_MAX_READS_PER_DAY })).toBe(
      "lecturas_dia",
    );
  });
  it("el cupo mensual solo mira en la etapa de lectura", () => {
    expect(profileAgentCapReason({ ...ok, readsThisMonth: 9 })).toBeNull();
  });
});

describe("topes por charla y por día", () => {
  it("turnos de huecos", () => {
    expect(profileAgentCapReason({ ...ok, gapTurns: PROFILE_AGENT_MAX_GAP_TURNS - 1 })).toBeNull();
    expect(profileAgentCapReason({ ...ok, gapTurns: PROFILE_AGENT_MAX_GAP_TURNS })).toBe("turnos");
    // la redacción no mira turnos
    expect(
      profileAgentCapReason({ ...ok, stage: "write", gapTurns: PROFILE_AGENT_MAX_GAP_TURNS }),
    ).toBeNull();
  });
  it("gasto de la charla, de la persona y global", () => {
    expect(profileAgentCapReason({ ...ok, flowCostUsd: 0.3 })).toBe("charla");
    expect(profileAgentCapReason({ ...ok, userSpendTodayUsd: 0.5 })).toBe("usuario");
    expect(profileAgentCapReason({ ...ok, dailySpendUsd: 1 })).toBe("global");
  });
  it("la lectura abre una charla nueva: el gasto de la charla no se mira", () => {
    expect(profileAgentCapReason({ ...ok, stage: "read", flowCostUsd: 9 })).toBeNull();
  });
  it("falla cerrado con números inválidos", () => {
    expect(profileAgentCapReason({ ...ok, gapTurns: Number.NaN })).toBe("turnos");
    expect(profileAgentCapReason({ ...ok, flowCostUsd: Number.NaN })).toBe("charla");
    expect(profileAgentCapReason({ ...ok, userSpendTodayUsd: Number.NaN })).toBe("usuario");
    expect(profileAgentCapReason({ ...ok, dailySpendUsd: Number.NaN })).toBe("global");
    expect(profileAgentCapReason({ ...ok, dailyCapUsd: 0 })).toBe("global");
    expect(profileAgentCapReason({ ...ok, stage: "read", readsThisMonth: Number.NaN })).toBe(
      "lecturas_mes",
    );
  });
});

describe("gasto de una fila: las llamadas fallidas con costo null cuentan", () => {
  it("usa el costo real si existe y el estimado del paso si es null o inválido", () => {
    expect(profileAgentRowCostUsd(0.01, 0.03)).toBe(0.01);
    expect(profileAgentRowCostUsd(0, 0.03)).toBe(0);
    expect(profileAgentRowCostUsd(null, 0.03)).toBe(0.03);
    expect(profileAgentRowCostUsd(undefined, 0.08)).toBe(0.08);
    expect(profileAgentRowCostUsd(Number.NaN, 0.03)).toBe(0.03);
    expect(profileAgentRowCostUsd(-1, 0.03)).toBe(0.03);
  });
  it("con filas fallidas el tope por charla se alcanza", () => {
    const rows = [null, null, null, null, null, null, null, null, null, null];
    const flowCostUsd = rows.reduce<number>((s, c) => s + profileAgentRowCostUsd(c, 0.03), 0);
    expect(flowCostUsd).toBeCloseTo(0.3);
    expect(profileAgentCapReason({ ...ok, flowCostUsd })).toBe("charla");
  });
});

describe("tope global y mensajes", () => {
  it("CV_PROFILE_AGENT_DAILY_CAP_USD: ausente 1, mal escrito o negativo cierra", () => {
    expect(profileAgentDailyCapUsd({})).toBe(1);
    expect(profileAgentDailyCapUsd({ CV_PROFILE_AGENT_DAILY_CAP_USD: " 2.5 " })).toBe(2.5);
    expect(profileAgentDailyCapUsd({ CV_PROFILE_AGENT_DAILY_CAP_USD: "abc" })).toBe(0);
    expect(profileAgentDailyCapUsd({ CV_PROFILE_AGENT_DAILY_CAP_USD: "-1" })).toBe(0);
  });
  it("cada tope tiene mensaje fijo con links a las pantallas manuales", () => {
    const caps: ProfileAgentCap[] = [
      "lecturas_mes",
      "lecturas_dia",
      "turnos",
      "charla",
      "usuario",
      "global",
    ];
    for (const c of caps) {
      const n = profileAgentCapNotice(c);
      expect(n.message.length).toBeGreaterThan(20);
      expect(n.links.map((l) => l.href)).toContain("/settings/historial");
    }
  });
  it("ventanas con now inyectado", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const w = profileAgentWindows(now);
    expect(w.daySince.toISOString()).toBe("2026-11-12T12:00:00.000Z");
    expect(w.monthSince.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });
});
