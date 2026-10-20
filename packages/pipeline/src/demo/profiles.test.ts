import { describe, expect, it } from "vitest";
import { buildEvaluateJobVars } from "../evaluation";
import {
  MIN_SUMMARY_CHARS,
  MAX_SUMMARY_CHARS,
  DEFAULT_CRITERIA_RULES,
  isValidCountry,
} from "../onboarding";
import { ROLE_KEYS } from "../skills/self-assessment";
import {
  DEMO_PROFILES,
  DEMO_PROFILE_KEYS,
  demoCriteriaRules,
  getDemoProfile,
  isDemoProfileKey,
} from "./profiles";

describe("DEMO_PROFILES", () => {
  it("son 3, con las claves del check de la tabla", () => {
    expect(DEMO_PROFILES.map((p) => p.key)).toEqual([...DEMO_PROFILE_KEYS]);
    expect(DEMO_PROFILES).toHaveLength(3);
  });

  it.each(DEMO_PROFILES.map((p) => [p.key, p] as const))(
    "%s arma las variables del evaluador",
    (_k, p) => {
      expect(isValidCountry(p.profile.locationCountry)).toBe(true);
      expect(p.profile.profileSummary.length).toBeGreaterThanOrEqual(MIN_SUMMARY_CHARS);
      expect(p.profile.profileSummary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
      expect(p.profile.profileSummary.split("\n").length).toBeGreaterThanOrEqual(4);
      expect(p.profile.profileSummary.split("\n").length).toBeLessThanOrEqual(6);
      for (const r of p.targetRoles) expect(ROLE_KEYS).toContain(r);
      const vars = buildEvaluateJobVars({
        promptRef: "evaluate_job@v1",
        profile: { ...p.profile, targetRoleLabel: "Puesto" },
        rules: demoCriteriaRules(),
        job: { title: "Titulo", companyRaw: "Empresa A", jdText: "Descripcion" },
      });
      expect(vars.profile_summary).toBe(p.profile.profileSummary);
      expect(String(vars.constraints)).toContain("Solo remoto: sí");
      expect(String(vars.constraints)).toContain("AR");
    },
  );

  it("usa los criterios por defecto del onboarding, sin reglas nuevas", () => {
    expect(demoCriteriaRules()).toEqual(DEFAULT_CRITERIA_RULES);
  });

  it("getDemoProfile / isDemoProfileKey", () => {
    expect(getDemoProfile("ai_engineer")?.label).toBe("AI engineer");
    expect(getDemoProfile("otro")).toBeNull();
    expect(isDemoProfileKey("fullstack_ssr")).toBe(true);
    expect(isDemoProfileKey("x")).toBe(false);
  });
});
