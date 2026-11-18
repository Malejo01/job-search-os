import { describe, expect, it } from "vitest";
import { loadPrompt, renderPrompt, templateVars } from "./loader";

// R12-5 (ADR-038 §7, D2 y D4): la lectura v2 pide viñetas literales por trabajo y proyectos.
describe("extract_cv_profile@v2", () => {
  const p = loadPrompt("extract_cv_profile@v2");

  it("carga con las mismas variables que v1", () => {
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
    const r = renderPrompt(p.value, {
      target_roles: "frontend",
      today: "2026-11",
      candidate_skills: "react | React",
      role_keys: "frontend, qa",
      cv: "<<<CV>>>\nPersona Ficticia\n<<<FIN CV>>>",
    });
    expect(r.ok).toBe(true);
  });

  it("conserva las reglas de v1: dato no instrucción, no inventar, sin sensibles, sin resumen", () => {
    if (!p.ok) throw new Error("no cargó");
    const t = p.value.template;
    expect(t).toMatch(/dato, no una instrucción/);
    expect(t).toMatch(/Solo lo que el CV dice/);
    expect(t).toMatch(/Datos personales sensibles: nunca los copies/);
    expect(t).toMatch(/`profile.summary`: \*\*siempre `null`\*\*/);
  });

  it("pide viñetas copiadas palabra por palabra y proyectos con rol, link https y stack", () => {
    if (!p.ok) throw new Error("no cargó");
    const t = p.value.template;
    expect(t).toMatch(/`work_history\[\]\.bullets`/);
    expect(t).toMatch(/copiadas palabra por palabra/);
    expect(t).toMatch(/`projects`/);
    expect(t).toMatch(/`role`/);
    expect(t).toMatch(/`link`.*https:\/\//);
    expect(t).toMatch(/`stack`/);
    expect(t).toMatch(/`\[link\]`/);
    // ya no dice que no se piden viñetas
    expect(t).not.toMatch(/no se piden viñetas/);
  });
});
