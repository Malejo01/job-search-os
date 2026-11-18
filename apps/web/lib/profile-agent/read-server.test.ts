import type { CvProposal } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { buildReadSummary } from "./read-server";

describe("buildReadSummary (R13-5)", () => {
  it("cuenta los proyectos aparte de los trabajos", () => {
    const proposal = {
      workHistory: [{}, {}, {}],
      education: [{}],
      projects: [{}, {}],
      skills: [{}, {}],
      languages: [],
      suggestedRoles: [],
      flags: { dropped: {} },
    } as unknown as CvProposal;
    expect(buildReadSummary(proposal)).toMatchObject({
      experience: 3,
      education: 1,
      projects: 2,
      skills: 2,
      languages: 0,
    });
  });
});
