import { GAP_TEMPLATE_CAREERS, GAP_TOPICS } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { loadGapTemplates, PROFILE_GAPS_PROMPT } from "./templates";

describe("plantillas de huecos (packages/prompts/profile_gaps.v1.md)", () => {
  const loaded = loadGapTemplates();

  it("el archivo real carga y valida: las 8 carreras de la beta más default", () => {
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    expect(PROFILE_GAPS_PROMPT).toBe("profile_gaps@v1");
    expect(Object.keys(loaded.value).sort()).toEqual([...GAP_TEMPLATE_CAREERS].sort());
    expect(GAP_TEMPLATE_CAREERS).toHaveLength(9);
  });

  it("cada carrera tiene los cuatro temas con su pregunta, y repregunta salvo en skill_level", () => {
    if (!loaded.ok) throw new Error("no carga");
    for (const career of GAP_TEMPLATE_CAREERS) {
      for (const topic of GAP_TOPICS) {
        const e = loaded.value[career]![topic];
        expect(e.question.length).toBeGreaterThan(10);
        if (topic === "skill_level") expect(e.followUp).toBeNull();
        else expect(e.followUp?.length).toBeGreaterThan(10);
      }
    }
  });

  it("las preguntas se adaptan a la carrera: no son todas la misma", () => {
    if (!loaded.ok) throw new Error("no carga");
    const questions = GAP_TEMPLATE_CAREERS.map((c) => loaded.value[c]!.duties.question);
    expect(new Set(questions).size).toBe(GAP_TEMPLATE_CAREERS.length);
  });

  it("un directorio sin el archivo falla cerrado, sin lanzar", () => {
    const r = loadGapTemplates("C:/no/existe/prompts");
    expect(r).toMatchObject({ ok: false, error: { kind: "prompt" } });
  });
});
