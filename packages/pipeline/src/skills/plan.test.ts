import { describe, expect, it } from "vitest";
import { buildPlan, easeFromClosureHours, planPriority } from "./plan";

describe("plan de formación: prioridad = demanda × (1 − nivel/3) × facilidad", () => {
  it("facilidad desde closure_hours: 16 h → 1, 40 h → 0,4, 80 h → 0,2, sin dato → 0,5", () => {
    expect(easeFromClosureHours(16)).toBe(1);
    expect(easeFromClosureHours(8)).toBe(1);
    expect(easeFromClosureHours(40)).toBeCloseTo(0.4, 6);
    expect(easeFromClosureHours(80)).toBeCloseTo(0.2, 6);
    expect(easeFromClosureHours(null)).toBe(0.5);
    expect(easeFromClosureHours(1000)).toBe(0.1);
  });

  it("una skill barata de cerrar le gana a una cara con la misma demanda; nivel 3 queda fuera", () => {
    expect(planPriority(40, 1, 16)).toBeCloseTo(40 * (2 / 3) * 1, 2);
    expect(planPriority(40, 0, 80)).toBeCloseTo(40 * 1 * 0.2, 2);
    expect(planPriority(40, 3, 16)).toBe(0);
    expect(planPriority(40, null, 16)).toBe(40); // sin nivel = 0
  });

  it("ordena por prioridad y estima horas restantes", () => {
    const plan = buildPlan([
      {
        slug: "ci_cd",
        mentions: 9,
        mustMentions: 9,
        weightedDemand: 41.5,
        level: 1,
        closureHours: 16,
      },
      { slug: "aws", mentions: 9, mustMentions: 9, weightedDemand: 38, level: 0, closureHours: 40 },
      {
        slug: "fine_tuning",
        mentions: 2,
        mustMentions: 2,
        weightedDemand: 3,
        level: 0,
        closureHours: 80,
      },
      {
        slug: "rag",
        mentions: 10,
        mustMentions: 9,
        weightedDemand: 46.2,
        level: 3,
        closureHours: 0,
      },
      {
        slug: "nosql",
        mentions: 3,
        mustMentions: 3,
        weightedDemand: 11.5,
        level: null,
        closureHours: null,
      },
    ]);
    expect(plan.map((p) => p.slug)).toEqual(["ci_cd", "aws", "nosql", "fine_tuning"]);
    expect(plan[0]).toMatchObject({ priority: 27.67, hoursRemaining: 11 });
    expect(plan[1]).toMatchObject({ priority: 15.2, hoursRemaining: 40 });
    expect(plan[2]).toMatchObject({ priority: 5.75, hoursRemaining: null });
  });
});
