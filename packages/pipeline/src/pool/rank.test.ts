import { describe, expect, it } from "vitest";
import { rankCandidates } from "./rank";

const d = (day: number) => new Date(Date.UTC(2026, 9, day));

describe("rankCandidates", () => {
  it("rol exacto primero, aunque tenga menos score", () => {
    const r = rankCandidates([
      { id: "a", exactRole: false, score: 9, postedAt: d(10) },
      { id: "b", exactRole: true, score: 4, postedAt: d(1) },
    ]);
    expect(r.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("dentro del mismo grupo, score desc y después fecha desc", () => {
    const r = rankCandidates([
      { id: "a", exactRole: true, score: 5, postedAt: d(1) },
      { id: "b", exactRole: true, score: 7, postedAt: d(1) },
      { id: "c", exactRole: true, score: 5, postedAt: d(9) },
    ]);
    expect(r.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("sin fecha va al final de su empate", () => {
    const r = rankCandidates([
      { id: "a", exactRole: false, score: 5, postedAt: null },
      { id: "b", exactRole: false, score: 5, postedAt: d(2) },
    ]);
    expect(r.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("el empate total se resuelve por id ascendente", () => {
    const r = rankCandidates([
      { id: "z", exactRole: false, score: 5, postedAt: d(2) },
      { id: "m", exactRole: false, score: 5, postedAt: d(2) },
      { id: "n", exactRole: false, score: 5, postedAt: null },
      { id: "b", exactRole: false, score: 5, postedAt: null },
    ]);
    expect(r.map((x) => x.id)).toEqual(["m", "z", "b", "n"]);
  });

  it("no muta la entrada y es estable entre corridas", () => {
    const input = [
      { id: "b", exactRole: false, score: 1, postedAt: null },
      { id: "a", exactRole: true, score: 1, postedAt: null },
    ];
    const copy = structuredClone(input);
    const first = rankCandidates(input);
    expect(input).toEqual(copy);
    expect(rankCandidates([...input].reverse())).toEqual(first);
  });
});
