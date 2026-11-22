import { describe, expect, it } from "vitest";
import {
  INTERVIEW_MAX_SIMULATIONS_PER_DAY,
  decideInterviewStart,
  interviewAverage,
  interviewProgress,
  interviewScoreLevel,
} from "./limits";

describe("decideInterviewStart", () => {
  it("deja empezar con menos de dos simulaciones en el día", () => {
    expect(INTERVIEW_MAX_SIMULATIONS_PER_DAY).toBe(2);
    expect(decideInterviewStart(0)).toEqual({ ok: true, left: 2 });
    expect(decideInterviewStart(1)).toEqual({ ok: true, left: 1 });
  });

  it("frena a la tercera", () => {
    expect(decideInterviewStart(2)).toEqual({ ok: false, reason: "daily_limit" });
    expect(decideInterviewStart(7)).toEqual({ ok: false, reason: "daily_limit" });
  });
});

describe("interviewProgress", () => {
  it("empieza en la pregunta 1 de 5", () => {
    expect(interviewProgress(0)).toEqual({ current: 1, total: 5, done: false });
  });
  it("avanza con cada respuesta y termina a las cinco", () => {
    expect(interviewProgress(3)).toEqual({ current: 4, total: 5, done: false });
    expect(interviewProgress(5)).toEqual({ current: 5, total: 5, done: true });
    expect(interviewProgress(9)).toEqual({ current: 5, total: 5, done: true });
  });
});

describe("interviewScoreLevel", () => {
  it("traduce el puntaje a un nivel, no a una palabra", () => {
    expect(interviewScoreLevel(10)).toBe("high");
    expect(interviewScoreLevel(8)).toBe("high");
    expect(interviewScoreLevel(7)).toBe("mid");
    expect(interviewScoreLevel(6)).toBe("mid");
    expect(interviewScoreLevel(5)).toBe("low");
    expect(interviewScoreLevel(4)).toBe("low");
    expect(interviewScoreLevel(3)).toBe("far");
    expect(interviewScoreLevel(0)).toBe("far");
  });
});

describe("interviewAverage", () => {
  it("sin respuestas no hay promedio", () => {
    expect(interviewAverage([])).toBeNull();
  });
  it("promedia los tres criterios de todas las respuestas, con un decimal", () => {
    expect(
      interviewAverage([
        { clarity: 7, relevance: 8, star: 4 },
        { clarity: 6, relevance: 6, star: 5 },
      ]),
    ).toBe(6);
    expect(interviewAverage([{ clarity: 7, relevance: 8, star: 8 }])).toBe(7.7);
  });
});
