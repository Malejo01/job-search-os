import { describe, expect, it } from "vitest";
import { cvSkillCandidates } from "./candidates";
import { CV_MAX_CANDIDATES } from "./limits";

const taxonomy = [
  { slug: "python", name: "Python", aliases: [] },
  { slug: "react", name: "React", aliases: [] },
  { slug: "docker", name: "Docker", aliases: [] },
  { slug: "sql", name: "SQL", aliases: [] },
];

describe("cvSkillCandidates", () => {
  it("las del texto primero, después las del puesto, sin repetidos", () => {
    const r = cvSkillCandidates("Trabajé con Docker y Python.", taxonomy, [
      "sql",
      "python",
      "react",
    ]);
    expect(
      r
        .map((c) => c.slug)
        .slice(0, 2)
        .sort(),
    ).toEqual(["docker", "python"]);
    expect(r.map((c) => c.slug).slice(2)).toEqual(["sql", "react"]);
    expect(r.find((c) => c.slug === "docker")).toEqual({ slug: "docker", name: "Docker" });
  });

  it("ignora slugs del puesto que no están en la taxonomía", () => {
    expect(cvSkillCandidates("nada", taxonomy, ["cobol"])).toEqual([]);
  });

  it("respeta el tope", () => {
    const big = Array.from({ length: CV_MAX_CANDIDATES + 20 }, (_, i) => ({
      slug: `skill${i}`,
      name: `Skill${i}x`,
      aliases: [],
    }));
    const r = cvSkillCandidates(
      "",
      big,
      big.map((b) => b.slug),
    );
    expect(r).toHaveLength(CV_MAX_CANDIDATES);
  });
});
