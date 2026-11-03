import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXTOS_ANI } from "./textos-ani";

const ROOT = join(__dirname, "../../..");

describe("textos para Ani (C8-18)", () => {
  it.each(TEXTOS_ANI.map((t) => [t.nombre, t] as const))(
    "%s: el archivo existe y el extracto sigue ahí",
    (_n, t) => {
      const path = join(ROOT, t.archivo);
      expect(existsSync(path), t.archivo).toBe(true);
      if (t.extracto) expect(readFileSync(path, "utf8")).toContain(t.extracto);
    },
  );

  it("cubre portada, /acceso, /precios, /ayuda, onboarding, estados vacíos, emails y la ayuda en contexto", () => {
    const areas = new Set(TEXTOS_ANI.map((t) => t.area));
    for (const a of [
      "Portada",
      "/acceso",
      "/precios",
      "/ayuda",
      "Onboarding",
      "Estados vacíos",
      "Emails",
    ]) {
      expect(areas.has(a), a).toBe(true);
    }
    expect([...areas].some((a) => a.startsWith("Ayuda en contexto"))).toBe(true);
  });
});
