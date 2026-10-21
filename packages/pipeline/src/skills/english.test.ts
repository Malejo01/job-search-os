import { describe, expect, it } from "vitest";
import skills from "../../../db/seeds/skills.json";
import { CEFR_LEVELS } from "../onboarding";
import {
  ENGLISH_SKILL_SLUGS,
  isEnglishSkillSlug,
  parseEnglishCefr,
  skillLevelsFromCefr,
} from "./english";

describe("skillLevelsFromCefr", () => {
  it.each([
    ["A1", 1, 0],
    ["A2", 1, 0],
    ["B1", 2, 0],
    ["B2", 3, 1],
    ["C1", 3, 2],
    ["C2", 3, 3],
  ] as const)("%s → intermedio %i, fluido %i", (cefr, mid, fluent) => {
    expect(skillLevelsFromCefr(cefr)).toEqual({
      english_intermediate: mid,
      english_fluent: fluent,
    });
  });

  it("cubre todos los niveles CEFR, con valores de 0 a 3 y sin bajar al subir de nivel", () => {
    let prev = { english_intermediate: 0, english_fluent: 0 };
    for (const cefr of CEFR_LEVELS) {
      const now = skillLevelsFromCefr(cefr);
      for (const v of Object.values(now)) expect([0, 1, 2, 3]).toContain(v);
      expect(now.english_intermediate).toBeGreaterThanOrEqual(prev.english_intermediate);
      expect(now.english_fluent).toBeGreaterThanOrEqual(prev.english_fluent);
      prev = now;
    }
  });

  it("devuelve una copia: modificarla no cambia la tabla", () => {
    skillLevelsFromCefr("B2").english_fluent = 0;
    expect(skillLevelsFromCefr("B2").english_fluent).toBe(1);
  });

  it("los slugs derivados existen en la taxonomía", () => {
    const known = new Set(skills.map((s) => s.slug));
    for (const slug of ENGLISH_SKILL_SLUGS) expect(known.has(slug), slug).toBe(true);
    expect(isEnglishSkillSlug("english_fluent")).toBe(true);
    expect(isEnglishSkillSlug("python")).toBe(false);
  });
});

describe("parseEnglishCefr", () => {
  it("acepta A1 a C2", () => {
    for (const l of CEFR_LEVELS) expect(parseEnglishCefr(l)).toEqual({ ok: true, cefr: l });
  });
  it("vacío o ausente: no toca el inglés", () => {
    for (const v of ["", "  ", undefined, null]) {
      expect(parseEnglishCefr(v)).toEqual({ ok: true, cefr: null });
    }
  });
  it("rechaza lo que no es un nivel", () => {
    for (const v of ["D1", "b2", "B2 ", "nativo", "A3"]) {
      // "B2 " con espacio se recorta y es válido; el resto no
      const r = parseEnglishCefr(v);
      expect(r.ok).toBe(v === "B2 ");
    }
  });
});
