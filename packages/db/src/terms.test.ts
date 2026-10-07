import { describe, expect, it } from "vitest";
// apps/web no tiene runner propio: la parte pura se prueba desde acá (como invitations.test.ts).
import { TERMS_VERSION, termsAccepted, validateTermsAcceptance } from "../../../apps/web/lib/terms";

describe("términos versionados (JS-106)", () => {
  it("la versión vigente es una fecha ISO", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("solo la casilla marcada ('on') acepta", () => {
    expect(termsAccepted("on")).toBe(true);
    for (const v of [null, undefined, "", "off", "true", "1", "ON", true, 1, " on"]) {
      expect(termsAccepted(v)).toBe(false);
    }
  });

  it("sin aceptar no hay versión para guardar; aceptando devuelve la vigente", () => {
    expect(validateTermsAcceptance(null)).toEqual({ ok: false, reason: "terminos" });
    expect(validateTermsAcceptance("on")).toEqual({ ok: true, version: TERMS_VERSION });
  });
});
