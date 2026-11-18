import { describe, expect, it } from "vitest";
import {
  isPlanOverride,
  PLAN_OVERRIDES,
  PLAN_OVERRIDE_LABELS,
  paymentOffer,
  TESTER_50_LINK_ENV,
} from "./plan-override";

const FULL = "https://mpago.la/precio-completo";
const HALF = "https://mpago.la/precio-especial";
const ENV = { MP_LINK_LISTA: FULL, [TESTER_50_LINK_ENV]: HALF };

describe("isPlanOverride", () => {
  it("solo acepta las marcas conocidas", () => {
    expect(PLAN_OVERRIDES).toEqual(["becado", "tester_50"]);
    expect(isPlanOverride("becado")).toBe(true);
    expect(isPlanOverride("tester_50")).toBe(true);
    for (const v of ["", "BECADO", "tester_100", null, undefined, 5, {}]) {
      expect(isPlanOverride(v)).toBe(false);
    }
    expect(Object.keys(PLAN_OVERRIDE_LABELS)).toEqual([...PLAN_OVERRIDES]);
  });
});

describe("paymentOffer", () => {
  it("sin marca queda como hoy: el link del plan, o ninguno", () => {
    expect(paymentOffer(ENV, "lista", null)).toEqual({ kind: "link", url: FULL });
    expect(paymentOffer(ENV, "lista", undefined)).toEqual({ kind: "link", url: FULL });
    expect(paymentOffer({}, "lista", null)).toEqual({ kind: "sin_link" });
    expect(paymentOffer({ MP_LINK_LISTA: "https://evil.example/x" }, "lista", null)).toEqual({
      kind: "sin_link",
    });
  });

  it("becado: sin link y «Tu plan está bonificado», aunque haya links cargados", () => {
    expect(paymentOffer(ENV, "lista", "becado")).toEqual({
      kind: "bonificado",
      message: "Tu plan está bonificado.",
    });
  });

  it("tester_50: el link de la variable propia, nunca el de precio completo", () => {
    expect(paymentOffer(ENV, "lista", "tester_50")).toEqual({ kind: "link", url: HALF });
  });

  it("tester_50 sin variable (o con una inválida) falla cerrado: escribir al equipo, no el precio completo", () => {
    for (const env of [
      { MP_LINK_LISTA: FULL },
      { MP_LINK_LISTA: FULL, [TESTER_50_LINK_ENV]: "" },
      { MP_LINK_LISTA: FULL, [TESTER_50_LINK_ENV]: "http://mpago.la/x" },
      { MP_LINK_LISTA: FULL, [TESTER_50_LINK_ENV]: "https://evil.example/mpago.la" },
      { MP_LINK_LISTA: FULL, [TESTER_50_LINK_ENV]: "no es una url" },
    ]) {
      const offer = paymentOffer(env, "lista", "tester_50");
      expect(offer.kind).toBe("escribir");
      expect(JSON.stringify(offer)).not.toContain(FULL);
    }
  });

  it("una marca desconocida tampoco muestra el precio completo", () => {
    const offer = paymentOffer(ENV, "lista", "tester_100");
    expect(offer.kind).toBe("escribir");
    expect(JSON.stringify(offer)).not.toContain(FULL);
  });

  it("el plan gratis no tiene link propio: sin marca no se ofrece ninguno", () => {
    expect(paymentOffer(ENV, "gratis", null)).toEqual({ kind: "sin_link" });
  });
});
