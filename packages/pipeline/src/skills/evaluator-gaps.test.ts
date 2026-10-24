import { describe, expect, it } from "vitest";
import { countGapMentions } from "./evaluator-gaps";
import { compileTaxonomy } from "./match";

const terms = compileTaxonomy([
  { slug: "power_bi", name: "Power BI", aliases: ["powerbi", "dax"] },
  { slug: "python", name: "Python", aliases: [] },
  { slug: "sql", name: "SQL", aliases: [] },
]);

describe("countGapMentions (121 §6, E4d)", () => {
  it("cuenta en cuántas evaluaciones aparece cada skill como gap", () => {
    const counts = countGapMentions(
      [["Power BI avanzado", "Python"], ["experiencia con DAX"], ["Python (deseable)"]],
      terms,
    );
    expect(Object.fromEntries(counts)).toEqual({ power_bi: 2, python: 2 });
  });

  it("una skill nombrada dos veces en la misma evaluación cuenta una vez", () => {
    const counts = countGapMentions([["Power BI", "dashboards en PowerBI y DAX"]], terms);
    expect(counts.get("power_bi")).toBe(1);
  });

  it("lo que no está en la taxonomía no cuenta, y sin evaluaciones no hay nada", () => {
    expect(countGapMentions([["Kubernetes", "liderazgo"]], terms).size).toBe(0);
    expect(countGapMentions([], terms).size).toBe(0);
  });

  it("textos vacíos no cuentan y uno larguísimo se corta a los primeros 300 caracteres", () => {
    const counts = countGapMentions(
      [["", "   ", "sql " + "x".repeat(5000), "x".repeat(5000) + " python"]],
      terms,
    );
    expect(Object.fromEntries(counts)).toEqual({ sql: 1 });
  });
});
