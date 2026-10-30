import { describe, expect, it } from "vitest";
import { compareJobPriority, type JobPriority } from "./job-priority";

const job = (score: number | null, blockers = 0, risks = 0): JobPriority => ({
  score,
  blockers,
  risks,
});

describe("compareJobPriority", () => {
  it("score manda sobre todo: más score primero aunque tenga más bloqueadores y riesgos", () => {
    expect(compareJobPriority(job(80, 3, 5), job(70, 0, 0))).toBeLessThan(0);
    expect(compareJobPriority(job(70, 0, 0), job(80, 3, 5))).toBeGreaterThan(0);
  });

  it("a igual score gana menos bloqueadores aunque tenga más riesgos", () => {
    expect(compareJobPriority(job(75, 0, 4), job(75, 1, 0))).toBeLessThan(0);
  });

  it("a igual score y bloqueadores gana menos riesgos", () => {
    expect(compareJobPriority(job(75, 1, 1), job(75, 1, 2))).toBeLessThan(0);
  });

  it("empate total devuelve 0 (el desempate lo pone quien llama)", () => {
    expect(compareJobPriority(job(75, 1, 2), job(75, 1, 2))).toBe(0);
    expect(compareJobPriority(job(null), job(null))).toBe(0);
  });

  it("sin score va al final, aunque la otra tenga score 0 y muchos bloqueadores", () => {
    expect(compareJobPriority(job(0, 5, 5), job(null))).toBeLessThan(0);
    expect(compareJobPriority(job(null), job(0, 5, 5))).toBeGreaterThan(0);
  });

  it("entre dos sin score también desempata por bloqueadores y riesgos", () => {
    expect(compareJobPriority(job(null, 0, 1), job(null, 1, 0))).toBeLessThan(0);
    expect(compareJobPriority(job(null, 0, 1), job(null, 0, 2))).toBeLessThan(0);
  });

  it("es simétrico en signo", () => {
    const samples = [
      job(90),
      job(75, 0, 4),
      job(75, 1, 0),
      job(75, 1, 2),
      job(75, 1, 2),
      job(0, 3, 3),
      job(null),
      job(null, 2, 0),
    ];
    for (const a of samples) {
      for (const b of samples) {
        // `+ 0` normaliza -0 a 0 (Object.is los distingue)
        expect(Math.sign(compareJobPriority(a, b)) + 0).toBe(
          -Math.sign(compareJobPriority(b, a)) + 0,
        );
      }
    }
  });

  it("sirve para Array.prototype.sort con desempate de quien llama", () => {
    const rows = [
      { id: "e", ...job(null) },
      { id: "d", ...job(75, 1, 0) },
      { id: "c", ...job(75, 0, 4) },
      { id: "b", ...job(75, 0, 1) },
      { id: "a", ...job(75, 0, 1) },
      { id: "f", ...job(90, 2, 2) },
    ];
    const sorted = [...rows].sort(
      (x, y) => compareJobPriority(x, y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
    );
    expect(sorted.map((r) => r.id)).toEqual(["f", "a", "b", "c", "d", "e"]);
  });
});
