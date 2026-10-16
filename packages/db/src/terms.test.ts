import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("los dos textos tienen `actualizado` igual a TERMS_VERSION y ninguna nota de revisión", () => {
    for (const n of ["privacidad", "terminos"]) {
      const md = readFileSync(
        join(__dirname, "../../../apps/web/content/legal", `${n}.md`),
        "utf8",
      );
      expect(md).toMatch(new RegExp(`^---\\r?\\nactualizado: ${TERMS_VERSION}\\r?\\n`));
      // `{{MAURO:` no se chequea acá: mientras exista, la página muestra el aviso de borrador.
      expect(md.replace("[A DEFINIR: plazo de retención de los logs]", "")).not.toMatch(
        /\[(?:A REVISAR|A CONFIRMAR|CONFIRMAR|CONSULTAR|A DEFINIR)\b/,
      );
    }
  });
});
