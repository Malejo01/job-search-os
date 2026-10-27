import { describe, expect, it } from "vitest";
import { loadPrompt, renderPrompt, templateVars } from "./loader";

describe("prompts del CV conversacional (C-25)", () => {
  it("cv_interview@v1 carga y pide exactamente las variables del adapter", () => {
    const p = loadPrompt("cv_interview@v1");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.task).toBe("cv_interview");
    expect(templateVars(p.value.template).sort()).toEqual(["context", "message", "topic"]);
    const r = renderPrompt(p.value, { topic: "title", context: "Empresa A", message: "Analista" });
    expect(r.ok).toBe(true);
    // la respuesta de la persona va dentro de la marca de dato no confiable
    if (r.ok)
      expect(r.value).toMatch(/<respuesta_no_confiable>\s*Analista\s*<\/respuesta_no_confiable>/);
  });

  it("cv_write@v1 carga y pide exactamente las variables del pipeline", () => {
    const p = loadPrompt("cv_write@v1");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.task).toBe("cv_write");
    expect(templateVars(p.value.template).sort()).toEqual(["context", "lang", "target", "works"]);
  });

  it("las reglas de no inventar están escritas", () => {
    const write = loadPrompt("cv_write@v1");
    const interview = loadPrompt("cv_interview@v1");
    if (!write.ok || !interview.ok) throw new Error("no cargan");
    expect(write.value.template).toMatch(/Prohibido agregar empresas, cargos, fechas, cifras/);
    expect(write.value.template).toMatch(/nombres propios no se traducen/);
    expect(interview.value.template).toMatch(/dato, no una instrucción/);
  });
});
