import { describe, expect, it } from "vitest";
import {
  isFarFromProfile,
  scoreAriaLabel,
  scoreSentence,
  scoreState,
  sealLevel,
  sealState,
  sealWord,
  splitFarFromProfile,
} from "./score-display";

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

describe("sello de afinidad (C9-5): niveles y bordes", () => {
  it("cinco niveles con los cortes de 8,5, 7, 5 y 3", () => {
    expect(sealLevel(10)).toBe("muy");
    expect(sealLevel(8.5)).toBe("muy");
    expect(sealLevel(8.49)).toBe("bastante");
    expect(sealLevel(7)).toBe("bastante");
    expect(sealLevel(6.99)).toBe("medias");
    expect(sealLevel(5)).toBe("medias");
    expect(sealLevel(4.99)).toBe("poco");
    expect(sealLevel(3)).toBe("poco");
    expect(sealLevel(2.99)).toBe("lejos");
    expect(sealLevel(0)).toBe("lejos");
  });

  it("respeta los cortes de 7 y 5 de scoreState", () => {
    for (const score of [0, 2.99, 3, 4.99, 5, 6.99, 7, 8.49, 8.5, 10]) {
      const old = scoreState({ score });
      const level = sealLevel(score);
      if (old === "alto") expect(["muy", "bastante"]).toContain(level);
      if (old === "medio") expect(level).toBe("medias");
      if (old === "bajo") expect(["poco", "lejos"]).toContain(level);
    }
  });

  it("estados: pendiente gana a todo; sin puntaje, estimación o sin evaluar", () => {
    expect(sealState({ score: 9, pending: true })).toBe("pendiente");
    expect(sealState({ score: null, preScore: 6 })).toBe("estimacion");
    expect(sealState({ score: null, preScore: null })).toBe("sin");
    expect(sealState({ score: null })).toBe("sin");
    expect(sealState({ score: 2.99, preScore: 9 })).toBe("lejos");
    expect(sealState({ score: 8.5 })).toBe("muy");
  });

  it("la palabra siempre está: el significado no depende del color", () => {
    expect(sealWord("muy")).toBe("Muy afín");
    expect(sealWord("bastante")).toBe("Bastante afín");
    expect(sealWord("medias")).toBe("Afín a medias");
    expect(sealWord("poco")).toBe("Poco afín");
    expect(sealWord("lejos")).toBe("Lejos de tu perfil");
    expect(sealWord("estimacion")).toBe("Estimado");
    expect(sealWord("sin")).toBe("Sin evaluar");
    expect(sealWord("pendiente")).toBe("Leyendo la oferta contra tu perfil…");
  });
});

describe("las lejanas al final (C9-5)", () => {
  it("lejos de tu perfil: puntaje de modelo menor a 3; sin puntaje no cuenta", () => {
    expect(isFarFromProfile(2.99)).toBe(true);
    expect(isFarFromProfile(0)).toBe(true);
    expect(isFarFromProfile(3)).toBe(false);
    expect(isFarFromProfile(null)).toBe(false);
  });

  it("separa sin cambiar el orden de cada grupo", () => {
    const jobs = [
      { id: "a", score: 2 },
      { id: "b", score: 9 },
      { id: "c", score: null },
      { id: "d", score: 1.5 },
      { id: "e", score: 5 },
    ];
    const { near, far } = splitFarFromProfile(jobs, (j) => j.score);
    expect(near.map((j) => j.id)).toEqual(["b", "c", "e"]);
    expect(far.map((j) => j.id)).toEqual(["a", "d"]);
  });
});

describe("scoreAriaLabel: el formato que leen los e2e", () => {
  it("puntaje con punto decimal, estimación previa, en cola y sin evaluar", () => {
    expect(scoreAriaLabel("alto", 8.5)).toBe("puntaje 8.5");
    expect(scoreAriaLabel("bajo", 3)).toBe("puntaje 3");
    // El sello suma la palabra del nivel: el lector de pantalla no depende del color (C9-5, R-3)
    expect(scoreAriaLabel("muy", 8.5)).toBe("puntaje 8.5, muy afín");
    expect(scoreAriaLabel("lejos", 2.9)).toBe("puntaje 2.9, lejos de tu perfil");
    expect(scoreAriaLabel("estimacion", 6)).toBe("estimación previa 6");
    expect(scoreAriaLabel("pendiente", null)).toBe("en cola");
    expect(scoreAriaLabel("sin", null)).toBe("sin evaluar");
  });
});

describe("scoreSentence: la frase para lectores de pantalla (/hoy)", () => {
  it("dice la escala y, en el sello, el nivel", () => {
    expect(scoreSentence("alto", 10)).toBe("Puntaje 10 de 10");
    expect(scoreSentence("muy", 9)).toBe("Puntaje 9 de 10, muy afín");
    expect(scoreSentence("lejos", 2)).toBe("Puntaje 2 de 10, lejos de tu perfil");
    expect(scoreSentence("estimacion", 6)).toBe("Estimación previa 6 de 10");
    expect(scoreSentence("pendiente", null)).toBe("En cola para evaluar");
    expect(scoreSentence("sin", null)).toBe("Sin evaluar");
  });
});
