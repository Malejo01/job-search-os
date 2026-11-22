import { describe, expect, it } from "vitest";
import {
  ANSWER_ERRORS,
  CRITERIA,
  formatAverage,
  scoreWord,
  SENIORITY_OPTIONS,
  START_ERRORS,
} from "../app/(app)/interview/copy";

// Todos los códigos de error que pueden volver del servidor tienen un mensaje fijo para la persona.
const START_CODES = [
  "not_found",
  "daily_limit",
  "capped",
  "llm_failed",
  "unauthorized",
  "bad_request",
  "server",
];
const ANSWER_CODES = [
  "not_found",
  "empty",
  "too_short",
  "finished",
  "capped",
  "busy",
  "llm_failed",
  "unauthorized",
  "bad_request",
  "server",
];

describe("copy del simulador de entrevistas", () => {
  it("cada código de error de inicio y de respuesta tiene su mensaje", () => {
    for (const code of START_CODES) expect(START_ERRORS[code], code).toBeTruthy();
    for (const code of ANSWER_CODES) expect(ANSWER_ERRORS[code], code).toBeTruthy();
  });

  it("los mensajes de error no culpan ni prometen nada", () => {
    for (const message of [...Object.values(START_ERRORS), ...Object.values(ANSWER_ERRORS)]) {
      expect(message).not.toMatch(/garantiz|conseguir|ATS|uh|tranqui/i);
    }
  });

  it("los tres criterios son claridad, relevancia y STAR", () => {
    expect(CRITERIA.map((c) => c.key)).toEqual(["clarity", "relevance", "star"]);
    expect(CRITERIA.map((c) => c.label)).toEqual(["Claridad", "Relevancia", "Estructura STAR"]);
  });

  it("cada nivel de puntaje tiene su palabra", () => {
    expect(scoreWord("high")).toBe("Muy bien");
    expect(scoreWord("far")).toBe("A trabajar");
    expect(new Set(["high", "mid", "low", "far"].map((l) => scoreWord(l as never))).size).toBe(4);
  });

  it("el promedio lleva coma decimal", () => {
    expect(formatAverage(7.4)).toBe("7,4");
    expect(formatAverage(6)).toBe("6");
  });

  it("los niveles ofrecidos coinciden con los de la base", () => {
    expect(SENIORITY_OPTIONS.map(([value]) => value)).toEqual([
      "trainee",
      "junior",
      "semi_senior",
      "senior",
      "lead",
    ]);
  });
});
