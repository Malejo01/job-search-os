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
  isFinalCap,
  maxStepCostUsd,
  monthlyConversationLimit,
  remainingMessages,
  remainingMessagesNotice,
  resolveConversationLimits,
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

  it("el turno 20 entra y el 21 no", () => {
    expect(checkTurnStart({ turns: 19, costUsd: 0 }, monthly, false).ok).toBe(true);
    expect(checkTurnStart({ turns: 20, costUsd: 0 }, monthly, false)).toEqual({
      ok: false,
      error: "turns",
    });
  });

  it("costo desconocido falla cerrado y 0,50 exacto ya es tope", () => {
    expect(checkTurnStart({ turns: 1, costUsd: null }, monthly, false)).toEqual({
      ok: false,
      error: "cost_unknown",
    });
    expect(checkTurnStart({ turns: 1, costUsd: 0.5 }, monthly, false)).toEqual({
      ok: false,
      error: "usd",
    });
    expect(checkTurnStart({ turns: 1, costUsd: 0.4999 }, monthly, false).ok).toBe(true);
    // El tope viejo (0,12) ya no corta
    expect(checkTurnStart({ turns: 1, costUsd: 0.12 }, monthly, false).ok).toBe(true);
  });

  it("con topes propios, los usa en vez de los de siempre", () => {
    const own = { maxTurnsPerConversation: 3, maxUsdPerConversation: 0.2 };
    expect(checkTurnStart({ turns: 2, costUsd: 0.19 }, monthly, false, own).ok).toBe(true);
    expect(checkTurnStart({ turns: 3, costUsd: 0 }, monthly, false, own)).toEqual({
      ok: false,
      error: "turns",
    });
    expect(checkTurnStart({ turns: 1, costUsd: 0.2 }, monthly, false, own)).toEqual({
      ok: false,
      error: "usd",
    });
  });
});

describe("resolveConversationLimits", () => {
  it("sin variables, los defaults (0,50 y 20) y sin avisos", () => {
    expect(resolveConversationLimits({})).toEqual({
      limits: { maxTurnsPerConversation: 20, maxUsdPerConversation: 0.5 },
      invalid: [],
    });
    expect(resolveConversationLimits({ maxTurns: " ", maxUsd: "" }).invalid).toEqual([]);
  });

  it("toma valores válidos", () => {
    const r = resolveConversationLimits({ maxTurns: "30", maxUsd: "0.75" });
    expect(r.limits).toEqual({ maxTurnsPerConversation: 30, maxUsdPerConversation: 0.75 });
    expect(r.invalid).toEqual([]);
  });

  it("un valor inválido vuelve al default y se informa", () => {
    for (const bad of ["abc", "0", "-3", "2.5", "51", "1e2", "NaN"]) {
      const r = resolveConversationLimits({ maxTurns: bad });
      expect(r.limits.maxTurnsPerConversation).toBe(20);
      expect(r.invalid).toEqual(["maxTurns"]);
    }
    for (const bad of ["abc", "0", "-1", "5.01", "99", "1e2", "0,5", "Infinity"]) {
      const r = resolveConversationLimits({ maxUsd: bad });
      expect(r.limits.maxUsdPerConversation).toBe(0.5);
      expect(r.invalid).toEqual(["maxUsd"]);
    }
  });

  it("cada variable se valida por separado", () => {
    const r = resolveConversationLimits({ maxTurns: "x", maxUsd: "1" });
    expect(r.limits).toEqual({ maxTurnsPerConversation: 20, maxUsdPerConversation: 1 });
    expect(r.invalid).toEqual(["maxTurns"]);
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
    expect(checkStep(1, 10, 0.48, 0.02).ok).toBe(true);
    expect(checkStep(1, 10, 0.48, 0.0201)).toEqual({ ok: false, error: "usd" });
    const own = { maxTurnsPerConversation: 20, maxUsdPerConversation: 0.12 };
    expect(checkStep(1, 10, 0.1, 0.02, own).ok).toBe(true);
    expect(checkStep(1, 10, 0.1, 0.0201, own)).toEqual({ ok: false, error: "usd" });
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

describe("remainingMessages y remainingMessagesNotice", () => {
  const max = AGENT_LIMITS.maxTurnsPerConversation;

  it("sale del mismo tope de turnos y nunca es negativo", () => {
    expect(remainingMessages(0)).toBe(max);
    expect(remainingMessages(max)).toBe(0);
    expect(remainingMessages(max + 5)).toBe(0);
    expect(remainingMessages(NaN)).toBe(0);
  });

  it("el default es 20 y con otro tope cuenta contra ese", () => {
    expect(max).toBe(20);
    expect(remainingMessages(0, 30)).toBe(30);
    expect(remainingMessages(29, 30)).toBe(1);
    expect(remainingMessagesNotice(28, 30)).toBe("Te quedan 2 mensajes en esta charla");
    expect(remainingMessagesNotice(18, 30)).toBeNull();
  });

  it("avisa solo cuando quedan 2 o menos (y más de 0)", () => {
    expect(remainingMessagesNotice(0)).toBeNull();
    expect(remainingMessagesNotice(max - 3)).toBeNull();
    expect(remainingMessagesNotice(max - 2)).toBe("Te quedan 2 mensajes en esta charla");
    expect(remainingMessagesNotice(max - 1)).toBe("Te queda 1 mensaje en esta charla");
    expect(remainingMessagesNotice(max)).toBeNull();
  });
});

describe("isFinalCap", () => {
  it("los topes de la charla cierran; largo del mensaje y pasos no", () => {
    expect(isFinalCap("turns")).toBe(true);
    expect(isFinalCap("usd")).toBe(true);
    expect(isFinalCap("monthly_conversations")).toBe(true);
    expect(isFinalCap("message_too_long")).toBe(false);
    expect(isFinalCap("steps")).toBe(false);
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

  it("cincuenta pasos de 0,01 llegan al tope aunque la suma flotante no dé justo 0,5", () => {
    let c: number | null = 0;
    for (let i = 0; i < 50; i++) c = addCost(c, 0.01);
    expect(checkTurnStart({ turns: 1, costUsd: c }, monthly, false)).toEqual({
      ok: false,
      error: "usd",
    });
    // Con el tope viejo configurado a mano, doce pasos de 0,01 también
    let d: number | null = 0;
    for (let i = 0; i < 12; i++) d = addCost(d, 0.01);
    const old = { maxTurnsPerConversation: 20, maxUsdPerConversation: 0.12 };
    expect(checkTurnStart({ turns: 1, costUsd: d }, monthly, false, old)).toEqual({
      ok: false,
      error: "usd",
    });
  });
});
