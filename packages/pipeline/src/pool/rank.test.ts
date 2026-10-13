import { describe, expect, it } from "vitest";
import { interleaveByRole, rankCandidates } from "./rank";

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

describe("interleaveByRole", () => {
  const c = (id: string, roleHints: string[]) => ({ id, roleHints });

  it("dos puestos con 5 candidatas cada uno: A, B, A, B...", () => {
    const ranked = [
      ...[1, 2, 3, 4, 5].map((n) => c(`a${n}`, ["qa"])),
      ...[1, 2, 3, 4, 5].map((n) => c(`b${n}`, ["ux_ui"])),
    ];
    const r = interleaveByRole(ranked, ["qa", "ux_ui"]);
    expect(r.map((x) => x.id)).toEqual([
      "a1",
      "b1",
      "a2",
      "b2",
      "a3",
      "b3",
      "a4",
      "b4",
      "a5",
      "b5",
    ]);
    expect(r.map((x) => x.matchedRole)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? "qa" : "ux_ui")),
    );
  });

  it("sin señal al final, con matchedRole null", () => {
    const ranked = [c("x", []), c("a1", ["qa"]), c("y", ["backend"]), c("b1", ["ux_ui"])];
    const r = interleaveByRole(ranked, ["qa", "ux_ui"]);
    expect(r.map((x) => x.id)).toEqual(["a1", "b1", "x", "y"]);
    expect(r.slice(2).map((x) => x.matchedRole)).toEqual([null, null]);
  });

  it("un grupo más corto no frena al otro", () => {
    const ranked = [c("a1", ["qa"]), c("a2", ["qa"]), c("a3", ["qa"]), c("b1", ["ux_ui"])];
    const r = interleaveByRole(ranked, ["qa", "ux_ui"]);
    expect(r.map((x) => x.id)).toEqual(["a1", "b1", "a2", "a3"]);
  });

  it("una oferta con ambos puestos va al primero elegido", () => {
    const r = interleaveByRole([c("m", ["ux_ui", "qa"])], ["qa", "ux_ui"]);
    expect(r[0]!.matchedRole).toBe("qa");
  });

  it("un solo puesto mantiene el orden de entrada; sin puestos, todo sin señal", () => {
    const ranked = [c("1", ["qa"]), c("3", ["qa"]), c("2", [])];
    expect(interleaveByRole(ranked, ["qa"]).map((x) => x.id)).toEqual(["1", "3", "2"]);
    expect(interleaveByRole(ranked, []).map((x) => x.id)).toEqual(["1", "3", "2"]);
    expect(interleaveByRole([], ["qa", "ux_ui"])).toEqual([]);
  });

  it("no muta la entrada", () => {
    const ranked = [c("a", ["ux_ui"]), c("b", ["qa"])];
    interleaveByRole(ranked, ["qa", "ux_ui"]);
    expect(ranked.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
