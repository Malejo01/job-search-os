import { describe, expect, it } from "vitest";
import { preScore } from "./prescore";

const sk = (slug: string, level: number | null, isMust = true) => ({
  slug,
  name: slug,
  isMust,
  level,
});

describe("preScore: lo que se sabe sin LLM", () => {
  it("sin skills mapeadas asume 5 y lo dice", () => {
    const p = preScore({ flags: [], skills: [], salaryMaxUsd: null, salaryFloorUsd: null });
    expect(p).toMatchObject({ score: 5, coverage: null, have: [], missing: [] });
    expect(p.adjustments[0]?.rule).toBe("sin_skills");
  });

  it("3 + 6 × cobertura: todo cubierto → 9, nada cubierto → 3; sin nivel no cuenta", () => {
    expect(
      preScore({
        flags: [],
        skills: [sk("rag", 3), sk("react", 3), sk("aws", null)],
        salaryMaxUsd: null,
        salaryFloorUsd: null,
      }),
    ).toMatchObject({ score: 9, coverage: 1, have: ["rag", "react"], unknown: ["aws"] });
    expect(
      preScore({
        flags: [],
        skills: [sk("aws", 0), sk("kubernetes", 1)],
        salaryMaxUsd: null,
        salaryFloorUsd: null,
      }),
    ).toMatchObject({ score: 3, coverage: 0, missing: ["aws", "kubernetes"] });
  });

  it("riesgos del prefiltro restan, el salario bajo el piso resta, el cap de título acota", () => {
    const p = preScore({
      flags: ["location_risk", "many_candidates", "domain_keyword:growth", "title_cap:6"],
      skills: [sk("rag", 3), sk("aws", 0)],
      salaryMaxUsd: 2000,
      salaryFloorUsd: 2500,
    });
    // 3 + 6 × 0.5 = 6 → −1 −0.5 −0.5 −1 = 3 (cap 6 no aplica porque ya está debajo)
    expect(p.score).toBe(3);
    expect(p.riesgos).toHaveLength(4);
    expect(p.cap).toBe(6);
    const capped = preScore({
      flags: ["title_cap:6"],
      skills: [sk("rag", 3)],
      salaryMaxUsd: null,
      salaryFloorUsd: null,
    });
    expect(capped.score).toBe(6);
    expect(capped.adjustments.at(-1)?.rule).toBe("title_cap");
  });

  it("redondea a medio punto y no sale de 0–10", () => {
    const p = preScore({
      flags: ["location_risk", "location_risk", "location_risk", "location_risk"],
      skills: [sk("aws", 0)],
      salaryMaxUsd: null,
      salaryFloorUsd: null,
    });
    expect(p.score).toBe(0);
  });
});
