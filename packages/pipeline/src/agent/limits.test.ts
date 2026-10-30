import { describe, expect, it } from "vitest";
import {
  addCost,
  AGENT_CAP_REASONS,
  AGENT_LIMITS,
  capMessage,
  checkStep,
  checkTurnStart,
  checkUserMessage,
  estimateTokens,
  maxStepCostUsd,
  monthlyConversationLimit,
  stepCostUsd,
} from "./limits";

const NOW = new Date("2026-10-27T12:00:00Z");
const monthly = { used: 0, limit: 3 };

describe("checkTurnStart", () => {
  it("deja empezar con cupo, turnos y gasto disponibles", () => {
    expect(checkTurnStart({ turns: 0, costUsd: 0 }, monthly, true).ok).toBe(true);
  });

  it("una conversación nueva sin cupo mensual se corta; una ya empezada no cuenta de nuevo", () => {
    const full = { used: 3, limit: 3 };
    expect(checkTurnStart({ turns: 0, costUsd: 0 }, full, true)).toEqual({
      ok: false,
      error: "monthly_conversations",
    });
    expect(checkTurnStart({ turns: 2, costUsd: 0.01 }, full, false).ok).toBe(true);
  });

  it("el turno 10 entra y el 11 no", () => {
    expect(checkTurnStart({ turns: 9, costUsd: 0 }, monthly, false).ok).toBe(true);
    expect(checkTurnStart({ turns: 10, costUsd: 0 }, monthly, false)).toEqual({
      ok: false,
      error: "turns",
    });
  });

  it("costo desconocido falla cerrado y 0,12 exacto ya es tope", () => {
    expect(checkTurnStart({ turns: 1, costUsd: null }, monthly, false)).toEqual({
      ok: false,
      error: "cost_unknown",
    });
    expect(checkTurnStart({ turns: 1, costUsd: 0.12 }, monthly, false)).toEqual({
      ok: false,
      error: "usd",
    });
    expect(checkTurnStart({ turns: 1, costUsd: 0.1199 }, monthly, false).ok).toBe(true);
  });
});

describe("checkStep", () => {
  it("el paso 5 (sexto) entra y el 6 no", () => {
    expect(checkStep(5, 100, 0, 0.001).ok).toBe(true);
    expect(checkStep(6, 100, 0, 0.001)).toEqual({ ok: false, error: "steps" });
  });

  it("12.000 tokens de entrada entran y 12.001 no", () => {
    expect(checkStep(0, 12_000, 0, 0.001).ok).toBe(true);
    expect(checkStep(0, 12_001, 0, 0.001)).toEqual({ ok: false, error: "input_tokens" });
  });

  it("sin costo conocido no corre", () => {
    expect(checkStep(0, 10, null, 0.001)).toEqual({ ok: false, error: "cost_unknown" });
    expect(checkStep(0, 10, 0, null)).toEqual({ ok: false, error: "cost_unknown" });
  });

  it("el peor caso del paso tiene que entrar en lo que queda", () => {
    expect(checkStep(1, 10, 0.1, 0.02).ok).toBe(true);
    expect(checkStep(1, 10, 0.1, 0.0201)).toEqual({ ok: false, error: "usd" });
  });
});

describe("costos", () => {
  const rates = { inputUsdPerMtok: 1, outputUsdPerMtok: 4 };

  it("stepCostUsd usa las tarifas por millón", () => {
    expect(stepCostUsd(rates, 1_000_000, 0)).toBe(1);
    expect(stepCostUsd(rates, 1000, 500)).toBeCloseTo(0.003, 10);
  });

  it("sin tarifa o sin tokens devuelve null", () => {
    expect(stepCostUsd({ inputUsdPerMtok: null, outputUsdPerMtok: 4 }, 1, 1)).toBeNull();
    expect(stepCostUsd(rates, null, 1)).toBeNull();
    expect(stepCostUsd(rates, 1, null)).toBeNull();
  });

  it("maxStepCostUsd suma la salida máxima por paso", () => {
    expect(maxStepCostUsd(rates, 1000)).toBeCloseTo(
      (1000 * 1 + AGENT_LIMITS.maxOutputTokensPerStep * 4) / 1_000_000,
      10,
    );
    expect(maxStepCostUsd({ inputUsdPerMtok: 1, outputUsdPerMtok: null }, 1000)).toBeNull();
  });

  it("addCost contagia null", () => {
    expect(addCost(0.01, 0.02)).toBeCloseTo(0.03, 10);
    expect(addCost(null, 0.02)).toBeNull();
    expect(addCost(0.01, null)).toBeNull();
  });

  it("estimateTokens sobreestima: un token cada 3 caracteres", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("x".repeat(36_000))).toBe(12_000);
  });
});

describe("checkUserMessage", () => {
  it("2.000 caracteres entran y 2.001 no", () => {
    expect(checkUserMessage("a".repeat(2000)).ok).toBe(true);
    expect(checkUserMessage("a".repeat(2001))).toEqual({ ok: false, error: "message_too_long" });
  });
});

describe("monthlyConversationLimit", () => {
  const input = { plan: "fundador", planUntil: null, now: NOW };

  it("con los precios apagados rige el plan gratis (3)", () => {
    expect(monthlyConversationLimit({}, input)).toBe(3);
  });

  it("con los precios encendidos rige el plan: pago 30, vencido 3", () => {
    const on = { PRICING_ENABLED: "1" };
    expect(monthlyConversationLimit(on, input)).toBe(30);
    expect(
      monthlyConversationLimit(on, { ...input, planUntil: new Date("2026-10-01T00:00:00Z") }),
    ).toBe(3);
  });

  it("ASSISTANT_MONTHLY_CONVERSATIONS válido pisa todo; inválido se ignora", () => {
    expect(monthlyConversationLimit({ ASSISTANT_MONTHLY_CONVERSATIONS: "50" }, input)).toBe(50);
    for (const bad of ["0", "-1", "1001", "abc", "2.5", ""]) {
      expect(monthlyConversationLimit({ ASSISTANT_MONTHLY_CONVERSATIONS: bad }, input)).toBe(3);
    }
  });
});

describe("capMessage", () => {
  it("cada motivo tiene un texto fijo y los cuatro links a las pantallas", () => {
    for (const reason of AGENT_CAP_REASONS) {
      const m = capMessage(reason);
      expect(m.text.length).toBeGreaterThan(20);
      expect(m.links.map((l) => l.href)).toEqual([
        "/settings/perfil",
        "/settings/skills",
        "/settings/criteria",
        "/settings#puesto",
      ]);
    }
  });

  it("el mensaje es siempre el mismo para el mismo motivo", () => {
    expect(capMessage("usd")).toEqual(capMessage("usd"));
    expect(capMessage("usd").text).not.toBe(capMessage("turns").text);
  });
});

describe("valores inválidos fallan cerrado", () => {
  const BAD = [NaN, -1, -Infinity, Infinity];
  const rates = { inputUsdPerMtok: 1, outputUsdPerMtok: 4 };

  it("costos: NaN, negativos o infinitos dan null", () => {
    for (const x of BAD) {
      expect(stepCostUsd({ inputUsdPerMtok: x, outputUsdPerMtok: 1 }, 1, 1)).toBeNull();
      expect(stepCostUsd({ inputUsdPerMtok: 1, outputUsdPerMtok: x }, 1, 1)).toBeNull();
      expect(stepCostUsd(rates, x, 1)).toBeNull();
      expect(stepCostUsd(rates, 1, x)).toBeNull();
      expect(maxStepCostUsd(rates, x)).toBeNull();
      expect(addCost(x, 0.01)).toBeNull();
      expect(addCost(0.01, x)).toBeNull();
    }
  });

  it("checkTurnStart: costo inválido → cost_unknown; contadores inválidos → su motivo", () => {
    for (const x of BAD) {
      expect(checkTurnStart({ turns: 0, costUsd: x }, monthly, false)).toEqual({
        ok: false,
        error: "cost_unknown",
      });
      expect(checkTurnStart({ turns: x, costUsd: 0 }, monthly, false)).toEqual({
        ok: false,
        error: "turns",
      });
      expect(checkTurnStart({ turns: 0, costUsd: 0 }, { used: 0, limit: x }, true)).toEqual({
        ok: false,
        error: "monthly_conversations",
      });
      expect(checkTurnStart({ turns: 0, costUsd: 0 }, { used: x, limit: 3 }, true)).toEqual({
        ok: false,
        error: "monthly_conversations",
      });
    }
    expect(checkTurnStart({ turns: 1.5, costUsd: 0 }, monthly, false).ok).toBe(false);
  });

  it("checkStep: paso, estimación y costos inválidos cortan", () => {
    for (const x of BAD) {
      expect(checkStep(x, 10, 0, 0.001)).toEqual({ ok: false, error: "steps" });
      expect(checkStep(0, x, 0, 0.001)).toEqual({ ok: false, error: "input_tokens" });
      expect(checkStep(0, 10, x, 0.001)).toEqual({ ok: false, error: "cost_unknown" });
      expect(checkStep(0, 10, 0, x)).toEqual({ ok: false, error: "cost_unknown" });
    }
    expect(checkStep(1.5, 10, 0, 0)).toEqual({ ok: false, error: "steps" });
  });

  it("doce pasos de 0,01 llegan al tope aunque la suma flotante dé 0,12000000000000002", () => {
    let c: number | null = 0;
    for (let i = 0; i < 12; i++) c = addCost(c, 0.01);
    expect(checkTurnStart({ turns: 1, costUsd: c }, monthly, false)).toEqual({
      ok: false,
      error: "usd",
    });
  });
});
