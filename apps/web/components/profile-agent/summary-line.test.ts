import { describe, expect, it } from "vitest";
import { summaryLine, type Summary } from "./summary-line";

const base: Summary = {
  experience: 3,
  education: 1,
  projects: 0,
  skills: 12,
  languages: 2,
  dropped: 0,
  suggestedRoles: [],
};

describe("summaryLine (R13-5)", () => {
  it("suma los proyectos en plural", () => {
    expect(summaryLine({ ...base, projects: 2 })).toBe(
      "3 trabajos, 1 estudio, 2 proyectos, 12 skills, 2 idiomas",
    );
  });
  it("usa el singular con un proyecto", () => {
    expect(summaryLine({ ...base, projects: 1 })).toContain("1 proyecto,");
    expect(summaryLine({ ...base, projects: 1 })).not.toContain("proyectos");
  });
  it("no menciona los proyectos cuando son 0", () => {
    expect(summaryLine(base)).toBe("3 trabajos, 1 estudio, 12 skills, 2 idiomas");
  });
});
