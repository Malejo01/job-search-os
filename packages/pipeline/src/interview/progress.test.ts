import { describe, expect, it } from "vitest";
import { buildInterviewProgress, INTERVIEW_PROGRESS_MAX_POINTS } from "./progress";

const day = 24 * 60 * 60 * 1000;
const p = (id: string, n: number, clarity: number, relevance: number, star: number) => ({
  id,
  at: n * day,
  clarity,
  relevance,
  star,
});

describe("buildInterviewProgress", () => {
  it("sin simulaciones terminadas no hay evolución", () => {
    expect(buildInterviewProgress([])).toEqual({ points: [], change: null });
  });

  it("con una sola no hay cambio que mostrar, pero sí su punto", () => {
    const r = buildInterviewProgress([p("a", 1, 6.04, 7, 5)]);
    expect(r.points).toEqual([{ id: "a", at: day, clarity: 6, relevance: 7, star: 5, overall: 6 }]);
    expect(r.change).toBeNull();
  });

  it("ordena de la más vieja a la más nueva sin importar el orden de entrada", () => {
    const r = buildInterviewProgress([p("c", 3, 8, 8, 8), p("a", 1, 4, 4, 4), p("b", 2, 6, 6, 6)]);
    expect(r.points.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("calcula el cambio entre la primera y la última, un decimal, con signo", () => {
    const r = buildInterviewProgress([
      p("a", 1, 4, 7, 5),
      p("b", 2, 5.5, 7, 4),
      p("c", 3, 7.2, 6.5, 8),
    ]);
    expect(r.change).toEqual({ clarity: 3.2, relevance: -0.5, star: 3 });
  });

  it("redondea cada puntaje y el promedio a un decimal", () => {
    const r = buildInterviewProgress([p("a", 1, 7.26, 6.74, 5.5)]);
    expect(r.points[0]).toMatchObject({ clarity: 7.3, relevance: 6.7, star: 5.5, overall: 6.5 });
  });

  it("se queda con las últimas simulaciones si hay más que el tope", () => {
    const many = Array.from({ length: INTERVIEW_PROGRESS_MAX_POINTS + 3 }, (_, i) =>
      p(`s${i}`, i, 5, 5, 5),
    );
    const r = buildInterviewProgress(many);
    expect(r.points).toHaveLength(INTERVIEW_PROGRESS_MAX_POINTS);
    expect(r.points[0]?.id).toBe("s3");
    expect(r.points.at(-1)?.id).toBe(`s${INTERVIEW_PROGRESS_MAX_POINTS + 2}`);
  });

  it("no modifica lo que recibe", () => {
    const input = [p("b", 2, 6, 6, 6), p("a", 1, 4, 4, 4)];
    const copy = structuredClone(input);
    buildInterviewProgress(input);
    expect(input).toEqual(copy);
  });
});
