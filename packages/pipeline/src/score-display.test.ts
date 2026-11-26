import { describe, expect, it } from "vitest";
import {
  formatAffinityScore,
  isFarFromProfile,
  roundScore,
  sealLevel,
  sealState,
  splitFarFromProfile,
} from "./score-display";

describe("los cuatro sellos (R30-02): niveles y bordes", () => {
  it("alta desde 7, media de 5 a 6,9 y baja debajo de 5", () => {
    expect(sealLevel(10)).toBe("alta");
    expect(sealLevel(7)).toBe("alta");
    expect(sealLevel(6.9)).toBe("media");
    expect(sealLevel(5)).toBe("media");
    expect(sealLevel(4.9)).toBe("baja");
    expect(sealLevel(0)).toBe("baja");
  });

  it("el corte usa el número ya redondeado a un decimal: el número nunca contradice al sello", () => {
    // 6,96 se ve «7,0»: es alta
    expect(formatAffinityScore(6.96)).toBe("7,0");
    expect(sealLevel(6.96)).toBe("alta");
    // 6,94 se ve «6,9»: es media (un 6,9 no se muestra como 7)
    expect(formatAffinityScore(6.94)).toBe("6,9");
    expect(sealLevel(6.94)).toBe("media");
    // 4,96 se ve «5,0»: es media; 4,94 se ve «4,9»: es baja
    expect(formatAffinityScore(4.96)).toBe("5,0");
    expect(sealLevel(4.96)).toBe("media");
    expect(formatAffinityScore(4.94)).toBe("4,9");
    expect(sealLevel(4.94)).toBe("baja");
  });

  it("para cualquier puntaje, el nivel sale del número que se ve", () => {
    for (let n = 0; n <= 1000; n++) {
      const score = n / 100;
      const visto = Number(formatAffinityScore(score).replace(",", "."));
      expect(sealLevel(score), `${score}`).toBe(sealLevel(visto));
    }
  });

  it("estados: pendiente gana a todo; sin puntaje es «sin_evaluar»", () => {
    expect(sealState({ score: 9, pending: true })).toBe("pendiente");
    expect(sealState({ score: null, pending: true })).toBe("pendiente");
    expect(sealState({ score: null })).toBe("sin_evaluar");
    expect(sealState({ score: 8.5 })).toBe("alta");
    expect(sealState({ score: 5.5 })).toBe("media");
    expect(sealState({ score: 3.5 })).toBe("baja");
    expect(sealState({ score: 0 })).toBe("baja");
  });
});

describe("el número del sello", () => {
  it("un decimal y coma, también en los enteros", () => {
    expect(formatAffinityScore(7.4)).toBe("7,4");
    expect(formatAffinityScore(7)).toBe("7,0");
    expect(formatAffinityScore(10)).toBe("10,0");
    expect(formatAffinityScore(0)).toBe("0,0");
    expect(formatAffinityScore(4.9)).toBe("4,9");
    expect(formatAffinityScore(5)).toBe("5,0");
    expect(formatAffinityScore(6.9)).toBe("6,9");
  });

  it("roundScore redondea a un decimal sin dejar -0", () => {
    expect(roundScore(7.44)).toBe(7.4);
    expect(roundScore(7.46)).toBe(7.5);
    expect(Object.is(roundScore(-0.01), 0)).toBe(true);
  });
});

describe("las lejanas al final (C9-5, hasta que R30-04 defina el orden nuevo)", () => {
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
