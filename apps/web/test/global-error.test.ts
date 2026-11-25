import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R28-01: `app/global-error.tsx` se renderiza sin el layout raíz, así que no hay Tailwind ni `globals.css`.
 * No se puede importar en Vitest (usa el alias `@/`) ni forzar el error de la raíz en un e2e, así que el test
 * lee el código fuente, como `mascota.test.ts`, y verifica lo que lo hace autosuficiente.
 */
const SRC = readFileSync(join(__dirname, "..", "app", "global-error.tsx"), "utf8");

describe("global-error: se ve bien sin el layout raíz", () => {
  it("trae su propio <html lang=es> y <body>", () => {
    expect(SRC).toContain('<html lang="es">');
    expect(SRC).toContain("<body");
  });

  it("lleva estilos propios: un <style> y ninguna clase de Tailwind", () => {
    expect(SRC).toContain("<style>{CSS}</style>");
    const clases = [...SRC.matchAll(/className="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(clases.length).toBeGreaterThan(0);
    for (const c of clases) {
      for (const parte of c.split(/\s+/)) expect(parte, `clase «${parte}»`).toMatch(/^ge-/);
    }
  });

  it("el botón mide al menos 44 px y tiene foco visible", () => {
    expect(SRC).toMatch(/\.ge-btn\{[^}]*min-height:44px/);
    expect(SRC).toContain(".ge-btn:focus-visible");
  });

  it("tiene versión oscura según el sistema", () => {
    expect(SRC).toContain("@media (prefers-color-scheme: dark)");
  });

  it("Afi es una <img> decorativa con alt vacío dentro de un contenedor aria-hidden", () => {
    expect(SRC).toContain("<img");
    expect(SRC).toContain('alt=""');
    expect(SRC).toContain('aria-hidden="true"');
  });

  it("nunca muestra error.message", () => {
    expect(SRC).not.toMatch(/\{\s*error\.message\s*\}/);
  });
});
