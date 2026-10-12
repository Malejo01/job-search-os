import { describe, expect, it } from "vitest";
import { roleDemand } from "./role-demand";

describe("roleDemand", () => {
  it("cuenta menciones y obligatorias por skill", () => {
    const r = roleDemand([
      {
        skills: [
          { slug: "react", isMust: true },
          { slug: "css", isMust: false },
        ],
      },
      { skills: [{ slug: "react", isMust: false }] },
      { skills: [{ slug: "react", isMust: true }] },
    ]);
    expect(r).toEqual([
      { slug: "react", mentions: 3, mustMentions: 2 },
      { slug: "css", mentions: 1, mustMentions: 0 },
    ]);
  });

  it("ordena por menciones y desempata por obligatorias y slug", () => {
    const r = roleDemand([
      {
        skills: [
          { slug: "b", isMust: false },
          { slug: "a", isMust: false },
          { slug: "c", isMust: true },
        ],
      },
    ]);
    expect(r.map((x) => x.slug)).toEqual(["c", "a", "b"]);
  });

  it("sin avisos o sin skills devuelve vacío", () => {
    expect(roleDemand([])).toEqual([]);
    expect(roleDemand([{ skills: [] }])).toEqual([]);
  });

  it("una skill repetida en el mismo aviso cuenta una sola vez", () => {
    const r = roleDemand([
      {
        skills: [
          { slug: "sql", isMust: false },
          { slug: "sql", isMust: true },
        ],
      },
    ]);
    expect(r).toEqual([{ slug: "sql", mentions: 1, mustMentions: 1 }]);
  });
});
