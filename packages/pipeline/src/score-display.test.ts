import { describe, expect, it } from "vitest";
import { scoreAriaLabel, scoreSentence, scoreState } from "./score-display";

describe("scoreState (ScoreBadge, C7-4)", () => {
  it("alto desde 7, medio desde 5, bajo debajo", () => {
    expect(scoreState({ score: 7 })).toBe("alto");
    expect(scoreState({ score: 10 })).toBe("alto");
    expect(scoreState({ score: 6.9 })).toBe("medio");
    expect(scoreState({ score: 5 })).toBe("medio");
    expect(scoreState({ score: 4.9 })).toBe("bajo");
    expect(scoreState({ score: 0 })).toBe("bajo");
  });

  it("en cola gana a todo; sin score, estimación o sin evaluar", () => {
    expect(scoreState({ score: 8, pending: true })).toBe("pendiente");
    expect(scoreState({ score: null, preScore: 6 })).toBe("estimacion");
    expect(scoreState({ score: null, preScore: null })).toBe("sin");
    expect(scoreState({ score: null })).toBe("sin");
    // Con score, la estimación previa no se muestra
    expect(scoreState({ score: 3, preScore: 9 })).toBe("bajo");
  });
});

describe("scoreAriaLabel: el formato que leen los e2e", () => {
  it("puntaje con punto decimal, estimación previa, en cola y sin evaluar", () => {
    expect(scoreAriaLabel("alto", 8.5)).toBe("puntaje 8.5");
    expect(scoreAriaLabel("bajo", 3)).toBe("puntaje 3");
    expect(scoreAriaLabel("estimacion", 6)).toBe("estimación previa 6");
    expect(scoreAriaLabel("pendiente", null)).toBe("en cola");
    expect(scoreAriaLabel("sin", null)).toBe("sin evaluar");
  });
});

describe("scoreSentence: la frase para lectores de pantalla (/hoy)", () => {
  it("dice la escala", () => {
    expect(scoreSentence("alto", 10)).toBe("Puntaje 10 de 10");
    expect(scoreSentence("estimacion", 6)).toBe("Estimación previa 6 de 10");
    expect(scoreSentence("pendiente", null)).toBe("En cola para evaluar");
    expect(scoreSentence("sin", null)).toBe("Sin evaluar");
  });
});
