import { describe, expect, it } from "vitest";
import { BETA_PLAN, listedPlans, planDef, priceLabel, type PlanDef } from "./plans";
import {
  orderPlansForV2,
  planBenefits,
  planExclusions,
  plansView,
  pricePerDayArs,
  pricePerDayLabel,
  pricePerDayNote,
  pricingV2Enabled,
  recommendedPlanKey,
  RECOMMENDED_LABEL,
} from "./pricing-v2";

const BETA = planDef(BETA_PLAN);
const FREE = planDef("gratis");
const ALL = { cv: true, assistant: true };
const NONE = { cv: false, assistant: false };

const monthly = (priceArs: number | null, durationDays: number | null): PlanDef => ({
  ...BETA,
  priceArs,
  durationDays,
});

describe("pricingV2Enabled", () => {
  it("solo con PRICING_ENABLED=1 y PRICING_V2=1; sin cualquiera de las dos, apagado", () => {
    expect(pricingV2Enabled({})).toBe(false);
    expect(pricingV2Enabled({ PRICING_V2: "1" })).toBe(false);
    expect(pricingV2Enabled({ PRICING_ENABLED: "1" })).toBe(false);
    expect(pricingV2Enabled({ PRICING_ENABLED: "1", PRICING_V2: "true" })).toBe(false);
    expect(pricingV2Enabled({ PRICING_ENABLED: "1", PRICING_V2: "0" })).toBe(false);
    expect(pricingV2Enabled({ PRICING_ENABLED: "1", PRICING_V2: "1" })).toBe(true);
  });
});

describe("plansView: sin PRICING_V2 la lista queda como hoy", () => {
  it("sin la variable (o con los precios apagados) devuelve la lista de siempre, en su orden, sin recomendado", () => {
    for (const env of [
      {},
      { PRICING_ENABLED: "1" },
      { PRICING_ENABLED: "1", PRICING_V2: "0" },
      { PRICING_V2: "1" },
    ]) {
      const view = plansView(env, listedPlans(), BETA_PLAN);
      expect(view.v2).toBe(false);
      expect(view.plans).toEqual(listedPlans());
      expect(view.plans.map((p) => p.key)).toEqual(["gratis", "lista"]);
      expect(view.recommendedKey).toBeNull();
    }
  });

  it("con PRICING_ENABLED=1 y PRICING_V2=1 el más completo va primero y se recomienda el de la beta", () => {
    const view = plansView({ PRICING_ENABLED: "1", PRICING_V2: "1" }, listedPlans(), BETA_PLAN);
    expect(view.v2).toBe(true);
    expect(view.plans.map((p) => p.key)).toEqual(["lista", "gratis"]);
    expect(view.recommendedKey).toBe("lista");
  });

  it("los planes de la v2 son los mismos objetos: ningún monto cambia", () => {
    const view = plansView({ PRICING_ENABLED: "1", PRICING_V2: "1" }, listedPlans(), BETA_PLAN);
    for (const p of view.plans) expect(p).toEqual(planDef(p.key));
  });
});

describe("precio por día (redondeo hacia arriba)", () => {
  it("el plan de la beta sale de su monto: 20.000 ÷ 30 = 666,67, se muestra 667", () => {
    expect(pricePerDayArs(BETA)).toBe(667);
    expect(pricePerDayLabel(BETA)).toBe("$ 667 por día");
    expect(pricePerDayNote(BETA)).toContain("÷ 30 días");
    expect(pricePerDayNote(BETA)).toContain("redondeado hacia arriba");
  });

  it("nunca redondea a favor del producto: el total por día × días no baja del mensual", () => {
    for (const price of [1, 29, 30, 31, 999, 20_000, 20_001, 35_000]) {
      const perDay = pricePerDayArs(monthly(price, 30))!;
      expect(perDay * 30).toBeGreaterThanOrEqual(price);
      // y no se pasa de un peso por día
      expect((perDay - 1) * 30).toBeLessThan(price);
    }
  });

  it("si la división es exacta no suma nada", () => {
    expect(pricePerDayArs(monthly(30_000, 30))).toBe(1_000);
  });

  it("sin precio por día para gratis, sin monto, sin duración o pago único", () => {
    expect(pricePerDayArs(FREE)).toBeNull();
    expect(pricePerDayArs(monthly(null, 30))).toBeNull();
    expect(pricePerDayArs(monthly(20_000, null))).toBeNull();
    expect(pricePerDayArs(monthly(20_000, 0))).toBeNull();
    expect(pricePerDayArs(planDef("pase_3_meses"))).toBeNull();
    expect(pricePerDayLabel(FREE)).toBeNull();
    expect(pricePerDayNote(FREE)).toBeNull();
  });

  it("no cambia ningún monto: el precio sigue saliendo de PLANS", () => {
    expect(priceLabel(BETA)).toBe(`$ ${BETA.priceArs!.toLocaleString("es-AR")} por mes`);
    expect(BETA.priceArs).toBe(20_000);
  });
});

describe("orden y recomendado", () => {
  it("el plan más completo va primero y el orden de los demás se mantiene", () => {
    const ordered = orderPlansForV2(listedPlans());
    expect(ordered.map((p) => p.key)).toEqual(["lista", "gratis"]);
    // Entrada con topes iguales: no se reordena
    expect(orderPlansForV2([FREE, { ...FREE, key: "fundador" }]).map((p) => p.key)).toEqual([
      "gratis",
      "fundador",
    ]);
  });

  it("recomienda el plan de la beta solo si es pago, tiene precio y hay otro con quien compararlo", () => {
    expect(recommendedPlanKey(listedPlans(), BETA_PLAN)).toBe("lista");
    expect(recommendedPlanKey([BETA], BETA_PLAN)).toBeNull();
    expect(recommendedPlanKey([FREE, monthly(null, 30)], BETA_PLAN)).toBeNull();
    expect(recommendedPlanKey([FREE, FREE], "gratis")).toBeNull();
  });

  it("la etiqueta no afirma un dato que no se mide", () => {
    expect(RECOMMENDED_LABEL).toBe("Recomendado");
    expect(RECOMMENDED_LABEL).not.toMatch(/m[aá]s elegido|m[aá]s vendido|popular/i);
  });
});

describe("beneficios y lo que no incluye", () => {
  it("cada beneficio sale de un tope del plan, sin prometer entrevistas ni trabajo", () => {
    const lines = planBenefits(BETA.limits, ALL);
    expect(lines).toEqual([
      "Hasta 15 ofertas leídas por día contra tu perfil, con el porqué de cada una",
      "Buscás en hasta 4 carreras a la vez",
      "Hasta 10 lecturas de CV por mes para armar tu perfil",
      "Hasta 30 charlas con el asistente por mes",
    ]);
    for (const line of lines)
      expect(line).not.toMatch(/entrevista|empleo|trabajo asegurado|garant/i);
  });

  it("CV y asistente solo aparecen si la función está encendida", () => {
    expect(planBenefits(BETA.limits, NONE)).toHaveLength(2);
    expect(planBenefits(BETA.limits, { cv: true, assistant: false })).toHaveLength(3);
  });

  it("usa el singular con un solo elemento", () => {
    const one = { ...FREE.limits, evaluationsPerDay: 1, targetRoles: 1 };
    expect(planBenefits(one, NONE)[0]).toContain("1 oferta leída");
    expect(planBenefits(one, NONE)[1]).toContain("1 carrera ");
  });

  it("el plan gratis lista lo que no llega a tener, con los números reales de los dos planes", () => {
    expect(planExclusions(FREE, BETA, ALL)).toEqual([
      "No llega a las 15 ofertas por día: el tope es 3",
      "No llega a 4 carreras a la vez: el tope es 2",
      "No llega a 10 lecturas de CV por mes: el tope es 3",
      "No llega a 30 charlas con el asistente por mes: el tope es 3",
    ]);
    expect(planExclusions(FREE, BETA, NONE)).toHaveLength(2);
  });

  it("el plan más completo no lista topes menores; solo aclara que no hay factura en la beta", () => {
    expect(planExclusions(BETA, BETA, ALL)).toEqual(["Sin factura durante la beta"]);
  });

  it("no hay urgencia falsa ni garantía en ningún texto generado", () => {
    const all = [
      ...planBenefits(BETA.limits, ALL),
      ...planExclusions(FREE, BETA, ALL),
      ...planExclusions(BETA, BETA, ALL),
      pricePerDayLabel(BETA)!,
      pricePerDayNote(BETA)!,
    ].join(" ");
    expect(all).not.toMatch(
      /quedan|últimos|oferta por tiempo|antes que|tachad|garant|cancel[aá]s cuando|reembols/i,
    );
  });
});
