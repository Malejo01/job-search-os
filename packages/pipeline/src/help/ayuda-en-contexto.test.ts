import { describe, expect, it } from "vitest";
import { AYUDA_EN_CONTEXTO } from "./ayuda-en-contexto";

describe("ayuda en contexto (C8-6)", () => {
  const temas = Object.entries(AYUDA_EN_CONTEXTO);

  it("están las 5 pantallas donde una persona no técnica más se traba", () => {
    expect(Object.keys(AYUDA_EN_CONTEXTO).sort()).toEqual(
      ["aFavorTeFalta", "areas", "cv", "puntaje", "sinDescripcion"].sort(),
    );
  });

  it.each(temas)("%s: corto y sin tecnicismos", (_clave, t) => {
    expect(t.tema.length).toBeGreaterThan(0);
    expect(t.parrafos.length).toBeGreaterThan(0);
    for (const p of t.parrafos) {
      expect(p.length).toBeLessThanOrEqual(400);
      expect(p).not.toMatch(/\b(score|skills?|pool|llm|prompt|ia generativa|algoritmo|match)\b/i);
    }
  });
});
