import { describe, expect, it } from "vitest";
import { DEFAULT_CRITERIA_RULES } from "../../onboarding";
import type { ProfileGuideCard } from "../schemas";
import {
  applyGuideCriteria,
  guidePrefillFromAnswers,
  guideProfilePatch,
  guideReinforcePriority,
  guideRolesToSave,
} from "./apply";

const criteria: Extract<ProfileGuideCard, { kind: "criteria" }> = {
  kind: "criteria",
  modalities: null,
  country: null,
  maxYearsHard: null,
  salaryFloorUsdMonthly: null,
  titleBlocklistAdd: [],
};

describe("guideRolesToSave", () => {
  it("respeta el tope del plan y no recorta en silencio", () => {
    expect(guideRolesToSave({ kind: "roles", roles: ["abogacia", "comunicacion"] }, 2)).toEqual({
      ok: true,
      value: ["abogacia", "comunicacion"],
    });
    expect(guideRolesToSave({ kind: "roles", roles: ["abogacia", "comunicacion"] }, 1).ok).toBe(
      false,
    );
  });
});

describe("applyGuideCriteria", () => {
  it("solo cambia lo que trae la tarjeta; el resto queda como estaba", () => {
    const r = applyGuideCriteria(DEFAULT_CRITERIA_RULES, { ...criteria, maxYearsHard: 4 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.max_years_hard).toBe(4);
    expect(r.value.title_blocklist).toEqual(DEFAULT_CRITERIA_RULES.title_blocklist);
    expect(r.value.salary_floor_usd_monthly).toBe(DEFAULT_CRITERIA_RULES.salary_floor_usd_monthly);
  });

  it("suma el mínimo y las palabras a evitar sin repetir", () => {
    const r = applyGuideCriteria(DEFAULT_CRITERIA_RULES, {
      ...criteria,
      salaryFloorUsdMonthly: 900,
      titleBlocklistAdd: ["guardia", "director"],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.salary_floor_usd_monthly).toBe(900);
    expect(r.value.title_blocklist.filter((w) => w === "director")).toHaveLength(1);
    expect(r.value.title_blocklist).toContain("guardia");
  });

  it("sin reglas guardadas parte de las de por defecto", () => {
    expect(applyGuideCriteria(null, { ...criteria, maxYearsHard: 2 }).ok).toBe(true);
  });

  it("falla si se pasa de los límites del formulario (más de 100 entradas)", () => {
    const many = {
      ...DEFAULT_CRITERIA_RULES,
      title_blocklist: Array.from({ length: 100 }, (_, i) => `p${i}`),
    };
    const r = applyGuideCriteria(many, { ...criteria, titleBlocklistAdd: ["una más"] });
    expect(r).toEqual({ ok: false, error: "title_blocklist" });
  });
});

describe("guideProfilePatch y guidePrefillFromAnswers", () => {
  it("el patch lleva solo lo elegido, con remote_only en sincronía", () => {
    expect(guideProfilePatch(criteria)).toEqual({});
    expect(guideProfilePatch({ ...criteria, modalities: ["remoto"], country: "AR" })).toEqual({
      acceptedModalities: ["remoto"],
      remoteOnly: true,
      locationCountry: "AR",
    });
    expect(
      guideProfilePatch({
        ...criteria,
        modalities: ["remoto", "hibrido"],
        salaryFloorUsdMonthly: 500,
      }),
    ).toEqual({
      acceptedModalities: ["remoto", "hibrido"],
      remoteOnly: false,
      salaryFloorUsd: 500,
    });
  });

  it("el precargado del onboarding sale de las respuestas, sin tocar la base", () => {
    expect(
      guidePrefillFromAnswers({
        roles: ["abogacia"],
        modalities: [],
        country: "AR",
        avoid: ["guardia"],
      }),
    ).toEqual({
      targetRoles: ["abogacia"],
      acceptedModalities: null,
      country: "AR",
      salaryFloorUsd: null,
      maxYearsHard: null,
      titleBlocklistAdd: ["guardia"],
    });
    expect(guidePrefillFromAnswers({}).targetRoles).toEqual([]);
  });
});

describe("guideReinforcePriority", () => {
  const card = {
    kind: "reinforce",
    slug: "sql",
    name: "SQL",
    evidence: { offersAsking: 20, poolSize: 40 },
  } as const;
  it("más demanda y menos nivel dan más prioridad; sale de datos", () => {
    const sinNivel = guideReinforcePriority(card, null, 16);
    const nivel1 = guideReinforcePriority(card, 1, 16);
    expect(sinNivel).toBe(5);
    expect(nivel1).toBeLessThan(sinNivel);
    expect(
      guideReinforcePriority({ ...card, evidence: { offersAsking: 4, poolSize: 40 } }, null, 16),
    ).toBeLessThan(sinNivel);
  });
});
