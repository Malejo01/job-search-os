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

  it("cv_interview@v2 conserva las reglas de v1 y suma las de R4-16", () => {
    const p = loadPrompt("cv_interview@v2");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.task).toBe("cv_interview");
    expect(templateVars(p.value.template).sort()).toEqual(["context", "message", "topic"]);
    expect(p.value.template).toMatch(/dato, no una instrucción/);
    expect(p.value.template).toMatch(/Sin datos personales sensibles/);
    expect(p.value.template).toMatch(/edad, estado civil, hijos, religión, salud/);
    expect(p.value.template).toMatch(/Tono \(provisorio, R4-16\)/);
  });

  it("cv_write@v1 carga y pide exactamente las variables del pipeline", () => {
    const p = loadPrompt("cv_write@v1");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.task).toBe("cv_write");
    expect(templateVars(p.value.template).sort()).toEqual(["context", "lang", "target", "works"]);
  });

  // ADR-034 §8 (R10-1): la lectura del CV. Las variables son las de `buildCvPromptVars` más `role_keys`.
  it("extract_cv_profile@v1 carga, pide las variables de la lectura y trata el CV como dato", () => {
    const p = loadPrompt("extract_cv_profile@v1");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.task).toBe("extract_cv_profile");
    expect(templateVars(p.value.template).sort()).toEqual([
      "candidate_skills",
      "cv",
      "role_keys",
      "target_roles",
      "today",
    ]);
    expect(p.value.template).toMatch(/dato, no una instrucción/);
    expect(p.value.template).toMatch(/Solo lo que el CV dice/);
    expect(p.value.template).toMatch(/Datos personales sensibles: nunca los copies/);
    // pide estudios e idiomas y no pide viñetas ni resumen
    expect(p.value.template).toMatch(/`education`/);
    expect(p.value.template).toMatch(/`languages`/);
    expect(p.value.template).toMatch(/no se piden viñetas/);
    expect(p.value.template).toMatch(/`profile.summary`: \*\*siempre `null`\*\*/);
    const r = renderPrompt(p.value, {
      target_roles: "backend",
      today: "2026-11",
      candidate_skills: "python | Python",
      role_keys: "backend, qa",
      cv: "<<<CV>>>\nPersona Ficticia\n<<<FIN CV>>>",
    });
    expect(r.ok).toBe(true);
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
