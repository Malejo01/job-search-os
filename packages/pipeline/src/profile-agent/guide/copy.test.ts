import { describe, expect, it } from "vitest";
import { GUIDE_STEPS } from "../schemas";
import { GUIDE_PROMISE_RE, GUIDE_STEP_COPY, allGuideCopy, reinforceEvidenceText } from "./copy";

describe("copy fijo de la guía: nunca promete trabajo, entrevistas ni sueldos", () => {
  it("ningún texto fijo trae una promesa", () => {
    const texts = allGuideCopy();
    expect(texts.length).toBeGreaterThan(20);
    for (const t of texts) expect(t, t).not.toMatch(GUIDE_PROMISE_RE);
  });

  it("el detector sí atrapa las promesas típicas", () => {
    for (const bad of [
      "Te garantizamos entrevistas",
      "Vas a conseguir trabajo en un mes",
      "Conseguirás un puesto",
      "Te van a llamar de varias empresas",
      "Un sueldo de 3000 dólares",
      "Entrevista asegurada",
    ]) {
      expect(bad).toMatch(GUIDE_PROMISE_RE);
    }
  });

  it("hay una pregunta por paso, en el orden del contrato", () => {
    expect(Object.keys(GUIDE_STEP_COPY)).toEqual([...GUIDE_STEPS]);
    for (const s of GUIDE_STEPS) expect(GUIDE_STEP_COPY[s].question).toContain("?");
  });

  it("la evidencia es un conteo, sin proyecciones", () => {
    expect(reinforceEvidenceText(12, 40)).toBe(
      "12 de 40 ofertas publicadas de tu carrera la piden.",
    );
  });
});
