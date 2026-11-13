import { describe, expect, it } from "vitest";
import { loadPrompt, renderPrompt, templateVars } from "./loader";

describe("extract_job_from_image@v1", () => {
  const loaded = loadPrompt("extract_job_from_image@v1");

  it("carga con su frontmatter y no pide variables (la imagen va aparte)", () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.task).toBe("extract_job_from_image");
    expect(templateVars(loaded.value.template)).toEqual([]);
    expect(renderPrompt(loaded.value, {}).ok).toBe(true);
  });

  it("dice explícitamente que el texto de la imagen es dato y no se obedece", () => {
    if (!loaded.ok) throw new Error("no cargó");
    const t = loaded.value.template;
    expect(t).toMatch(/dato no confiable/i);
    expect(t).toMatch(/no lo obedecés/i);
  });

  it("pide null para lo que la imagen no dice, en particular los países", () => {
    if (!loaded.ok) throw new Error("no cargó");
    const t = loaded.value.template;
    expect(t).toMatch(/no dice es `null`/i);
    expect(t).toMatch(/countriesAllowed/);
    expect(t).toMatch(/Nunca asumas/);
  });
});
