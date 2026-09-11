import { describe, expect, it } from "vitest";
import { jaccard, shingleSimilarity, shingles, textShingles } from "./similarity";

describe("jaccard", () => {
  it("conjuntos iguales → 1, disjuntos → 0, vacíos → 0", () => {
    expect(jaccard(["a", "b"], ["b", "a"])).toBe(1);
    expect(jaccard(["a"], ["b"])).toBe(0);
    expect(jaccard([], [])).toBe(0);
  });
  it("ignora repetidos", () => {
    expect(jaccard(["a", "a", "b"], ["a", "b", "b", "c"])).toBeCloseTo(2 / 3);
  });
});

describe("shingles / textShingles", () => {
  it("5-gramas de palabras normalizadas, únicos", () => {
    const s = shingles("Uno dos tres cuatro cinco seis", 5);
    expect(s).toEqual(["uno dos tres cuatro cinco", "dos tres cuatro cinco seis"]);
  });
  it("texto más corto que n → un solo shingle con todo", () => {
    expect(shingles("hola mundo", 5)).toEqual(["hola mundo"]);
    expect(shingles("", 5)).toEqual([]);
  });
  it("normaliza mayúsculas, acentos y puntuación", () => {
    expect(shingles("Node.js, React!! y PostgreSQL (SQL) avanzado", 5)).toEqual([
      "node js react y postgresql",
      "js react y postgresql sql",
      "react y postgresql sql avanzado",
    ]);
  });
  it("textShingles devuelve un sketch determinista y acotado", () => {
    const long = Array.from({ length: 3000 }, (_, i) => `palabra${i}`).join(" ");
    const a = textShingles(long);
    const b = textShingles(long);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(512);
    expect(textShingles("corto")).toEqual(textShingles("corto"));
  });
});

describe("shingleSimilarity", () => {
  const base = Array.from({ length: 120 }, (_, i) => `token${i}`).join(" ");
  it("texto idéntico → 1", () => {
    expect(shingleSimilarity(textShingles(base), textShingles(base))).toBe(1);
  });
  it("texto con un párrafo agregado al final → alta (> 0.9)", () => {
    const withExtra = `${base} y ademas codigo ai sin tecnologia concreta`;
    expect(shingleSimilarity(textShingles(base), textShingles(withExtra))).toBeGreaterThan(0.9);
  });
  it("textos distintos → baja (< 0.3)", () => {
    const other = Array.from({ length: 120 }, (_, i) => `otra${i}`).join(" ");
    expect(shingleSimilarity(textShingles(base), textShingles(other))).toBeLessThan(0.3);
  });
  it("estimación por sketch coincide con el Jaccard exacto en textos cortos", () => {
    const a = "uno dos tres cuatro cinco seis siete ocho";
    const b = "uno dos tres cuatro cinco seis siete nueve";
    expect(shingleSimilarity(textShingles(a), textShingles(b))).toBeCloseTo(
      jaccard(shingles(a, 5), shingles(b, 5)),
    );
  });
});
