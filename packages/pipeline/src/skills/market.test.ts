import { describe, expect, it } from "vitest";
import { buildAgenda, computeDemand, weekStartOf } from "./market";

describe("computeDemand: Σ score × (must ? 1 : 0.4)", () => {
  it("pondera must completo y deseable al 40 %, y las ofertas sin score con el default", () => {
    const demand = computeDemand(
      [
        {
          jobId: "a",
          score: 8,
          skills: [
            { slug: "rag", isMust: true },
            { slug: "aws", isMust: false },
          ],
        },
        {
          jobId: "b",
          score: 6,
          skills: [
            { slug: "rag", isMust: true },
            { slug: "aws", isMust: true },
          ],
        },
        { jobId: "c", score: null, skills: [{ slug: "aws", isMust: true }] },
      ],
      { defaultScore: 5 },
    );
    expect(demand).toEqual([
      { slug: "aws", mentions: 3, mustMentions: 2, weightedDemand: 8 * 0.4 + 6 + 5 },
      { slug: "rag", mentions: 2, mustMentions: 2, weightedDemand: 14 },
    ]);
  });
});

describe("buildAgenda: gaps y diferenciales", () => {
  const demand = computeDemand([
    {
      jobId: "a",
      score: 8,
      skills: [
        { slug: "aws", isMust: true },
        { slug: "rag", isMust: true },
        { slug: "go", isMust: true },
      ],
    },
    {
      jobId: "b",
      score: 7,
      skills: [
        { slug: "aws", isMust: true },
        { slug: "rag", isMust: true },
        { slug: "docker", isMust: false },
      ],
    },
    { jobId: "c", score: 6, skills: [{ slug: "docker", isMust: true }] },
  ]);
  const levels = [
    { slug: "rag", level: 3 },
    { slug: "aws", level: 1 },
    { slug: "docker", level: 2 },
  ];

  it("gap = demanda con ≥ minMentions y nivel ≤ 1 (nivel desconocido cuenta como 0)", () => {
    const agenda = buildAgenda(demand, levels, { minMentions: 2 });
    expect(agenda.gaps.map((g) => g.slug)).toEqual(["aws"]); // go tiene 1 mención: no llega
    expect(agenda.differentials.map((g) => g.slug)).toEqual(["rag"]);
    expect(agenda.growing.map((g) => g.slug)).toEqual(["docker"]);
    expect(agenda.all.find((r) => r.slug === "go")?.level).toBeNull();
  });
});

describe("weekStartOf", () => {
  it("devuelve el lunes UTC", () => {
    expect(weekStartOf(new Date("2026-09-11T15:00:00Z"))).toBe("2026-09-07"); // viernes → lunes
    expect(weekStartOf(new Date("2026-09-13T23:00:00Z"))).toBe("2026-09-07"); // domingo → lunes anterior
    expect(weekStartOf(new Date("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
  });
});
