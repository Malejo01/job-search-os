import { describe, expect, it } from "vitest";
import { diffPoolSkills } from "./pool-diff";

describe("diffPoolSkills", () => {
  it("cuenta lo que se saca y lo que se suma, y marca solo los avisos que cambian", () => {
    const before = new Map([
      ["a", new Set(["payroll", "iam", "growth_marketing"])],
      ["b", new Set(["sql"])],
      ["c", new Set(["iam"])],
    ]);
    const after = new Map<string, readonly string[]>([
      ["a", ["payroll"]],
      ["b", ["sql"]],
      ["c", ["iam", "security"]],
      ["d", ["excel"]],
    ]);
    const { diff, changedIds } = diffPoolSkills(before, after);
    expect(changedIds).toEqual(["a", "c", "d"]);
    expect(diff.changedJobs).toBe(3);
    expect(diff.removedBySlug).toEqual({ iam: 1, growth_marketing: 1 });
    expect(diff.addedBySlug).toEqual({ security: 1, excel: 1 });
  });

  it("sin diferencias no hay nada que reescribir", () => {
    const { diff, changedIds } = diffPoolSkills(
      new Map([["a", new Set(["sql"])]]),
      new Map([["a", ["sql"]]]),
    );
    expect(changedIds).toEqual([]);
    expect(diff.changedJobs).toBe(0);
  });
});
