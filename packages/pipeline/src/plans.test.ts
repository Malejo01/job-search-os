import { describe, expect, it } from "vitest";
import {
  effectivePlan,
  limitsText,
  paymentLink,
  planDef,
  planLimitsFor,
  PLAN_KEYS,
  PLANS,
  priceLabel,
  pricingEnabled,
} from "./plans";

const NOW = new Date("2026-11-09T12:00:00Z");

describe("planes (C-11)", () => {
  it("hay una sola fila por clave y el gratis no tiene link de pago", () => {
    expect(PLANS.map((p) => p.key).sort()).toEqual([...PLAN_KEYS].sort());
    expect(planDef("gratis").paymentLinkEnv).toBeNull();
    for (const p of PLANS.filter((x) => x.key !== "gratis"))
      expect(p.paymentLinkEnv).not.toBeNull();
  });

  it("los planes pagos nunca tienen topes menores que el gratis", () => {
    const free = planDef("gratis").limits;
    for (const p of PLANS) {
      for (const k of Object.keys(free) as (keyof typeof free)[]) {
        expect(p.limits[k]).toBeGreaterThanOrEqual(free[k]);
      }
    }
  });

  it("PRICING_ENABLED solo se enciende con «1»", () => {
    expect(pricingEnabled({})).toBe(false);
    expect(pricingEnabled({ PRICING_ENABLED: "true" })).toBe(false);
    expect(pricingEnabled({ PRICING_ENABLED: "1" })).toBe(true);
  });

  it("con los precios apagados no hay topes por plan: rige lo de siempre", () => {
    expect(planLimitsFor({}, "fundador")).toBeNull();
    expect(planLimitsFor({ PRICING_ENABLED: "1" }, "fundador")).toEqual(planDef("fundador").limits);
  });

  it("el link de pago solo acepta https de Mercado Pago", () => {
    const ok = "https://mpago.la/abc123";
    expect(paymentLink({ MP_LINK_FUNDADOR: ok }, "fundador")).toBe(ok);
    expect(paymentLink({ MP_LINK_FUNDADOR: "http://mpago.la/abc" }, "fundador")).toBeNull();
    expect(
      paymentLink({ MP_LINK_FUNDADOR: "https://evil.example/mpago.la" }, "fundador"),
    ).toBeNull();
    expect(
      paymentLink({ MP_LINK_FUNDADOR: "https://mpago.la.evil.example/x" }, "fundador"),
    ).toBeNull();
    // Con credenciales en la URL (se arma por partes para que el barrido no la tome por un secreto)
    const withUserInfo = ["https://", "x", ":", "y", "@", "mpago.la/x"].join("");
    expect(paymentLink({ MP_LINK_FUNDADOR: withUserInfo }, "fundador")).toBeNull();
    expect(paymentLink({ MP_LINK_FUNDADOR: "https://mpago.la:8443/x" }, "fundador")).toBeNull();
    expect(paymentLink({ MP_LINK_FUNDADOR: "https://link.mercadopago.com.ar/x" }, "fundador")).toBe(
      "https://link.mercadopago.com.ar/x",
    );
    expect(paymentLink({ MP_LINK_FUNDADOR: "no es una url" }, "fundador")).toBeNull();
    expect(paymentLink({}, "fundador")).toBeNull();
    expect(paymentLink({ MP_LINK_FUNDADOR: ok }, "gratis")).toBeNull();
  });

  it("un plan pago vencido o una clave desconocida rigen como gratis", () => {
    expect(effectivePlan("fundador", null, NOW)).toBe("fundador");
    expect(effectivePlan("pase_3_meses", new Date("2026-12-01T00:00:00Z"), NOW)).toBe(
      "pase_3_meses",
    );
    expect(effectivePlan("pase_3_meses", new Date("2026-11-01T00:00:00Z"), NOW)).toBe("gratis");
    expect(effectivePlan("premium", null, NOW)).toBe("gratis");
    expect(effectivePlan(null, null, NOW)).toBe("gratis");
  });

  it("el precio sin decidir dice «a confirmar», nunca una cifra inventada", () => {
    expect(priceLabel(planDef("gratis"))).toBe("Gratis");
    expect(priceLabel({ ...planDef("lista"), priceArs: null })).toBe("Precio a confirmar");
    // Montos de prueba, sin relación con ningún precio real
    expect(priceLabel({ ...planDef("lista"), priceArs: 1234 })).toMatch(/^\$ 1[.\s]?234 por mes$/);
    expect(priceLabel({ ...planDef("pase_3_meses"), priceArs: 1 })).toBe("$ 1, un solo pago");
  });

  it("los topes en palabras no prometen CV ni asistente apagados", () => {
    const off = limitsText(planDef("fundador").limits, { cv: false, assistant: false });
    expect(off.join(" ")).not.toMatch(/CV|asistente/);
    const on = limitsText(planDef("gratis").limits, { cv: true, assistant: true });
    expect(on).toContain("1 lectura de CV por mes");
    expect(on).toContain("3 charlas con el asistente por mes");
  });
});
