import { describe, expect, it } from "vitest";
import { loadPrompt, renderPrompt, templateVars } from "./loader";

describe("extract_job_card@v1", () => {
  const loaded = loadPrompt("extract_job_card@v1");

  it("carga con su frontmatter y pide una sola variable: el aviso", () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.task).toBe("extract_job_card");
    expect(templateVars(loaded.value.template)).toEqual(["job"]);
    expect(renderPrompt(loaded.value, { job: "<<<AVISO>>>\nx\n<<<FIN AVISO>>>" }).ok).toBe(true);
  });

  it("dice que el aviso es dato no confiable y que las instrucciones del texto no se obedecen", () => {
    if (!loaded.ok) throw new Error("no cargó");
    const t = loaded.value.template;
    expect(t).toMatch(/dato no confiable/i);
    expect(t).toMatch(/no lo obedecés/i);
    expect(t).toMatch(/<<<AVISO>>>/);
    expect(t).toMatch(/<<<FIN AVISO>>>/);
  });

  it("pide cita literal, nada deducido y ningún veredicto", () => {
    if (!loaded.ok) throw new Error("no cargó");
    const t = loaded.value.template;
    expect(t).toMatch(/letra por letra/i);
    expect(t).toMatch(/Nada se deduce/);
    expect(t).toMatch(/Sin veredictos/);
    expect(t).toMatch(/sin_distinguir/);
  });

  it("las siete condiciones están nombradas", () => {
    if (!loaded.ok) throw new Error("no cargó");
    for (const k of [
      "modalidad",
      "desdeDonde",
      "salario",
      "experiencia",
      "ingles",
      "jornada",
      "contratacion",
    ]) {
      expect(loaded.value.template, k).toContain(`\`${k}\``);
    }
  });
});
