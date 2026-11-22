import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El detector de instrucciones y la validación del formulario se usan solo en el servidor (la acción y
 * `lib/onboarding`). El código de cliente del onboarding no los importa: si lo hiciera, el detector viajaría
 * en el bundle de `/onboarding`.
 */

const root = resolve(__dirname, "../..");
const CLIENT_FILES = [
  "app/onboarding/onboarding-form.tsx",
  "app/onboarding/steps.tsx",
  "app/onboarding/country-search.tsx",
  "components/profile-form.tsx",
  "components/role-picker.tsx",
];
// profileAgentFormPrefill: su módulo trae el detector (por el resumen); el cliente usa onboardingGuidePrefill
const SERVER_ONLY =
  /profileAgentFormPrefill|parseOnboarding|onboardingSchema|SUMMARY_IGNORED_SIGNALS|onboarding-parse|detectEvaluatorInjection|evaluator\/injection/;

describe("código de cliente del onboarding", () => {
  for (const file of CLIENT_FILES) {
    it(`${file} no importa el detector ni la validación del servidor`, () => {
      expect(readFileSync(resolve(root, file), "utf8")).not.toMatch(SERVER_ONLY);
    });
  }

  it("la acción del servidor guarda con la validación que usa el detector", () => {
    const action = readFileSync(resolve(root, "app/onboarding/actions.ts"), "utf8");
    expect(action).toContain("saveProfileFromForm");
    expect(readFileSync(resolve(root, "lib/onboarding.ts"), "utf8")).toContain("parseOnboarding(");
  });
});
