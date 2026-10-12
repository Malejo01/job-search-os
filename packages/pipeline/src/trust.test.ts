import { describe, expect, it } from "vitest";
import {
  fillTrustBody,
  TRUST_RESPONSABLE_FALLBACK,
  TRUST_RESPONSABLE_PLACEHOLDER,
  TRUST_TEXTS,
  trustResponsable,
} from "./trust";

describe("TRUST_TEXTS", () => {
  it("tiene las cuatro entradas, en orden", () => {
    expect(TRUST_TEXTS.map((t) => t.title)).toEqual([
      "Qué leemos",
      "Qué no leemos",
      "Cómo cortarlo",
      "Quién está detrás",
    ]);
    for (const t of TRUST_TEXTS) {
      expect(t.body.trim().length).toBeGreaterThan(30);
    }
  });

  it("dice qué se lee y qué no", () => {
    const [lee, noLee, cortar] = TRUST_TEXTS;
    expect(lee.body).toContain("llegan a tu dirección personal de ingesta");
    expect(lee.body).toContain("filtro de Gmail");
    expect(noLee.body).toMatch(/contraseñas/);
    expect(noLee.body).toMatch(/contactos/);
    expect(noLee.body).toContain("No tenemos acceso a tu cuenta de Gmail");
    expect(cortar.body).toContain("borrá tu cuenta");
  });

  it("solo la última lleva el marcador del responsable", () => {
    expect(TRUST_TEXTS.map((t) => t.body.includes(TRUST_RESPONSABLE_PLACEHOLDER))).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("no trae comandos, rutas de archivo ni códigos internos", () => {
    for (const t of TRUST_TEXTS) {
      const text = `${t.title} ${t.body}`;
      expect(text, t.id).not.toMatch(/`/);
      expect(text, t.id).not.toMatch(/\b(pnpm|npm|curl|sudo|psql|git)\b/i);
      expect(text, t.id).not.toMatch(/\.(ts|tsx|js|mjs|json|sql|md|env)\b/i);
      expect(text, t.id).not.toMatch(/[A-Za-z]+\/[A-Za-z]+/); // rutas o URL
      expect(text, t.id).not.toMatch(/\b[a-z]+_[a-z_]+\b/); // snake_case interno
      expect(text, t.id).not.toMatch(/\b[A-Z][A-Z_]{3,}\b/); // variables de entorno
    }
  });
});

describe("trustResponsable", () => {
  it("usa el valor cargado", () => {
    expect(trustResponsable("Empresa Ficticia SRL")).toBe("Empresa Ficticia SRL");
  });
  it("sin valor, vacío o demasiado largo: texto neutro", () => {
    expect(trustResponsable(undefined)).toBe(TRUST_RESPONSABLE_FALLBACK);
    expect(trustResponsable("")).toBe(TRUST_RESPONSABLE_FALLBACK);
    expect(trustResponsable("   ")).toBe(TRUST_RESPONSABLE_FALLBACK);
    expect(trustResponsable("x".repeat(500))).toBe(TRUST_RESPONSABLE_FALLBACK);
  });
  it("no deja barras de escape del markdown", () => {
    expect(trustResponsable("Persona [Ficticia] (A)")).toBe("Persona [Ficticia] (A)");
  });
});

describe("fillTrustBody", () => {
  it("reemplaza el marcador y no interpreta $ del valor", () => {
    const last = TRUST_TEXTS[3];
    const out = fillTrustBody(last.body, "Persona $& Ficticia");
    expect(out).toContain("Persona $& Ficticia");
    expect(out).not.toContain(TRUST_RESPONSABLE_PLACEHOLDER);
  });
});
