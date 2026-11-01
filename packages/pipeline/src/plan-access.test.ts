import { describe, expect, it } from "vitest";
import {
  BETA_OPENS_AT,
  EXPIRY_WARNING_DAYS,
  grantPeriod,
  planAccess,
  PLAN_SOURCES,
  isPlanSource,
} from "./plan-access";
import { planDef, priceLabel, priceReference } from "./plans";

const DAY = 86_400_000;
const NOW = new Date("2026-12-10T15:00:00Z");
const days = (n: number, from: Date = NOW) => new Date(from.getTime() + n * DAY);

describe("planAccess: en qué estado está el acceso (C3-1)", () => {
  it("sin plan pago, o con un valor desconocido, es «gratis» y no hay fecha", () => {
    for (const plan of ["gratis", "premium", null, undefined, 3]) {
      const a = planAccess({ plan, planUntil: null, planSource: null, now: NOW });
      expect(a).toMatchObject({ status: "gratis", plan: "gratis", until: null, daysLeft: null });
      expect(a.becado).toBe(false);
    }
  });

  it("un plan pago con más de 3 días queda «activo» y cuenta los días que faltan", () => {
    const a = planAccess({ plan: "lista", planUntil: days(20), planSource: "pago", now: NOW });
    expect(a).toMatchObject({ status: "activo", plan: "lista", daysLeft: 20, becado: false });
    expect(a.until).toEqual(days(20));
  });

  it("avisa a partir de 3 días: «por_vencer» incluye el límite", () => {
    expect(EXPIRY_WARNING_DAYS).toBe(3);
    const at = (n: number) =>
      planAccess({ plan: "lista", planUntil: days(n), planSource: "pago", now: NOW });
    expect(at(4).status).toBe("activo");
    expect(at(3).status).toBe("por_vencer");
    expect(at(3).daysLeft).toBe(3);
    expect(at(1).status).toBe("por_vencer");
  });

  it("cuenta los días hacia arriba: con 2 horas por delante todavía queda «1 día»", () => {
    const a = planAccess({
      plan: "lista",
      planUntil: new Date(NOW.getTime() + 2 * 3_600_000),
      planSource: "pago",
      now: NOW,
    });
    expect(a).toMatchObject({ status: "por_vencer", daysLeft: 1 });
  });

  it("en el instante exacto del vencimiento ya está «vencido» y rige el gratis", () => {
    const a = planAccess({ plan: "lista", planUntil: NOW, planSource: "pago", now: NOW });
    expect(a).toMatchObject({ status: "vencido", plan: "gratis", daysLeft: null });
    expect(a.until).toEqual(NOW);
  });

  it("vencido conserva la fecha en la que venció, para decírsela a la persona", () => {
    const venció = days(-5);
    const a = planAccess({ plan: "lista", planUntil: venció, planSource: "beca", now: NOW });
    expect(a).toMatchObject({ status: "vencido", plan: "gratis", becado: true });
    expect(a.until).toEqual(venció);
  });

  it("un plan pago sin fecha no vence", () => {
    const a = planAccess({ plan: "fundador", planUntil: null, planSource: null, now: NOW });
    expect(a).toMatchObject({ status: "sin_vencimiento", plan: "fundador", until: null });
    expect(a.daysLeft).toBeNull();
  });

  it("«becado» es solo la marca de beca y nada más", () => {
    const base = { plan: "lista", planUntil: days(10), now: NOW };
    expect(planAccess({ ...base, planSource: "beca" }).becado).toBe(true);
    expect(planAccess({ ...base, planSource: "pago" }).becado).toBe(false);
    expect(planAccess({ ...base, planSource: "otra" }).becado).toBe(false);
    expect(planAccess({ ...base, planSource: null }).becado).toBe(false);
  });

  it("coincide con effectivePlan: lo que rige hoy sale de la misma regla", () => {
    // Un plan pago con fecha vieja rige como gratis tanto acá como en los topes
    expect(
      planAccess({ plan: "pase_3_meses", planUntil: days(-1), planSource: null, now: NOW }).plan,
    ).toBe("gratis");
  });
});

describe("grantPeriod: hasta cuándo queda activo un plan (C3-1)", () => {
  const OPEN = BETA_OPENS_AT;

  it("la beta abre el 26/11 a las 00:00 de Argentina", () => {
    expect(OPEN.toISOString()).toBe("2026-11-26T03:00:00.000Z");
  });

  it("después de abrir, son 30 días desde ahora", () => {
    expect(grantPeriod({ now: NOW, currentUntil: null, days: 30 })).toEqual(days(30));
  });

  it("antes de abrir, los 30 días empiezan el día de apertura (la beca no se gasta antes)", () => {
    const antes = new Date("2026-11-10T12:00:00Z");
    expect(grantPeriod({ now: antes, currentUntil: null, days: 30 })).toEqual(days(30, OPEN));
  });

  it("renovar con el plan vigente suma a la fecha que ya tenía: no pierde días", () => {
    const vigente = days(5);
    expect(grantPeriod({ now: NOW, currentUntil: vigente, days: 30 })).toEqual(days(30, vigente));
  });

  it("renovar un plan vencido cuenta desde ahora, no desde la fecha vieja", () => {
    expect(grantPeriod({ now: NOW, currentUntil: days(-40), days: 30 })).toEqual(days(30));
  });

  it("rechaza una cantidad de días que no sea un entero entre 1 y 366", () => {
    for (const bad of [0, -1, 1.5, 367, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => grantPeriod({ now: NOW, currentUntil: null, days: bad })).toThrow(/días/);
    }
  });

  it("la fecha de apertura se puede cambiar (para tests y para correrla)", () => {
    const opensAt = new Date("2027-01-04T03:00:00Z");
    expect(grantPeriod({ now: NOW, currentUntil: null, days: 30, opensAt })).toEqual(
      days(30, opensAt),
    );
  });
});

describe("plan de la beta: precio y orígenes (C3-1)", () => {
  it("el plan de la beta es ARS 20.000 por mes, con USD 15 de referencia y 30 días", () => {
    const beta = planDef("lista");
    expect(beta.priceArs).toBe(20_000);
    expect(beta.priceUsdRef).toBe(15);
    expect(beta.durationDays).toBe(30);
    expect(priceLabel(beta)).toMatch(/^\$ 20[.\s]?000 por mes$/);
    expect(priceReference(beta)).toBe("USD 15 como referencia");
  });

  it("el gratis y los planes sin referencia en dólares no muestran referencia", () => {
    expect(priceReference(planDef("gratis"))).toBeNull();
    expect(priceReference(planDef("fundador"))).toBeNull();
  });

  it("solo hay dos orígenes: pago y beca", () => {
    expect([...PLAN_SOURCES]).toEqual(["pago", "beca"]);
    expect(isPlanSource("beca")).toBe(true);
    expect(isPlanSource("regalo")).toBe(false);
    expect(isPlanSource(null)).toBe(false);
  });
});
