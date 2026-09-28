import { describe, expect, it } from "vitest";
import { normalizeQuestion, questionTokens, rankAnswers } from "./answers";

describe("normalizeQuestion (JS-053)", () => {
  it("minúsculas, sin acentos, sin puntuación ni asterisco de obligatorio", () => {
    expect(normalizeQuestion("¿Cuál es tu disponibilidad?*")).toBe("cual es tu disponibilidad");
    expect(normalizeQuestion("  What are your SALARY expectations (USD)?  ")).toBe(
      "what are your salary expectations usd",
    );
  });

  it("la misma pregunta con otro formato normaliza igual", () => {
    expect(normalizeQuestion("Years of experience with TypeScript:")).toBe(
      normalizeQuestion("years of experience with typescript"),
    );
    expect(normalizeQuestion("Salary\n expectation — monthly")).toBe("salary expectation monthly");
  });

  it("conserva números; la puntuación interna pasa a espacio", () => {
    expect(normalizeQuestion("Do you have 3+ years in Node.js?")).toBe(
      "do you have 3 years in node js",
    );
  });

  it("vacía queda vacía", () => {
    expect(normalizeQuestion(" ?¿ ")).toBe("");
  });
});

describe("questionTokens", () => {
  it("saca palabras vacías en español e inglés", () => {
    expect(questionTokens("What are your salary expectations?")).toEqual([
      "salary",
      "expectations",
    ]);
    expect(questionTokens("¿Cuál es tu pretensión salarial?")).toEqual(["pretension", "salarial"]);
  });
});

describe("rankAnswers", () => {
  const a = (id: string, question: string, day: number) => ({
    id,
    question,
    updatedAt: new Date(Date.UTC(2026, 8, day)),
  });
  const bank = [
    a("salario", "What are your salary expectations?", 10),
    a("disponibilidad", "When can you start?", 12),
    a("ingles", "What is your English level?", 11),
    a("salario-es", "¿Cuál es tu pretensión salarial?", 9),
    a("ts", "Years of experience with TypeScript", 8),
  ];

  it("sin consulta devuelve todo, lo más reciente primero, hasta el límite", () => {
    expect(rankAnswers(bank, undefined, 3).map((r) => r.id)).toEqual([
      "disponibilidad",
      "ingles",
      "salario",
    ]);
    expect(rankAnswers(bank, "   ", 10)).toHaveLength(5);
  });

  it("con consulta devuelve solo las que comparten palabras, más coincidencias primero", () => {
    const out = rankAnswers(bank, "Expected salary (monthly, USD)", 10);
    expect(out.map((r) => r.id)).toEqual(["salario"]);
  });

  it("un prefijo de 4+ letras cuenta: 'expect' encuentra 'expectations'", () => {
    expect(rankAnswers(bank, "salary expect", 10).map((r) => r.id)).toEqual(["salario"]);
    // 'sal' es muy corto para prefijo: no matchea nada
    expect(rankAnswers(bank, "sal", 10)).toEqual([]);
  });

  it("empate de coincidencias → la más reciente primero", () => {
    const out = rankAnswers(
      [a("vieja", "English level", 1), a("nueva", "English proficiency", 20)],
      "english",
      10,
    );
    expect(out.map((r) => r.id)).toEqual(["nueva", "vieja"]);
  });

  it("más palabras en común gana a más reciente", () => {
    const out = rankAnswers(
      [a("parcial", "English", 20), a("completa", "English level", 1)],
      "english level",
      10,
    );
    expect(out.map((r) => r.id)).toEqual(["completa", "parcial"]);
  });

  it("no inventa coincidencias con palabras vacías", () => {
    expect(rankAnswers(bank, "what is your", 10)).toEqual([]);
  });

  it("no modifica la lista recibida", () => {
    const copy = [...bank];
    rankAnswers(bank, undefined, 10);
    expect(bank).toEqual(copy);
  });
});
