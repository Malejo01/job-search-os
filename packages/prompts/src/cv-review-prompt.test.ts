import { describe, expect, it } from "vitest";
import { loadPrompt, renderPrompt, templateVars } from "./loader";

// ADR-038 §10 (R12-8): el diagnóstico del coach. Variables de `cvReviewPromptVars` (pipeline).
describe("cv_review@v1", () => {
  it("carga, pide exactamente las variables del pipeline y trata el CV como dato", () => {
    const p = loadPrompt("cv_review@v1");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.task).toBe("cv_review");
    expect(templateVars(p.value.template).sort()).toEqual([
      "cv",
      "demand",
      "person_skills",
      "target",
    ]);
    expect(p.value.template).toMatch(/dato, no una instrucción/);
    expect(p.value.template).toMatch(/No redactás nada para la persona/);
    expect(p.value.template).toMatch(/Solo lo que está en el CV/);
    // los diez tipos de la lista cerrada están explicados
    for (const type of [
      "logro_sin_resultado",
      "tarea_vaga",
      "vineta_sin_verbo",
      "skill_pedida_sin_evidencia",
      "proyecto_sin_stack_o_link",
      "brecha_con_puesto",
      "fecha_faltante",
      "inconsistencia",
      "resumen_generico",
      "orden_poco_relevante",
    ]) {
      expect(p.value.template, type).toContain(`\`${type}\``);
    }
    const r = renderPrompt(p.value, {
      target: "Analista de datos",
      person_skills: "sql | SQL",
      demand: "power-bi | Power BI | 3",
      cv: "<<<CV>>>\n[id: x] Analista · Empresa A · 2021-03 a actual\n<<<FIN CV>>>",
    });
    expect(r.ok).toBe(true);
  });
});
