import { describe, expect, it } from "vitest";
import {
  PRIMER_USO_DONE,
  clampStep,
  primerUsoKey,
  shouldShowPrimerUso,
  tourSteps,
} from "../lib/primer-uso";

describe("primer uso tras el rediseño (R23-05)", () => {
  it("tiene entre 3 y 4 pasos, cada uno con título y texto", () => {
    const steps = tourSteps();
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(4);
    for (const s of steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });

  it("la clave de almacenamiento es por persona", () => {
    expect(primerUsoKey("u1")).not.toBe(primerUsoKey("u2"));
  });

  it("se muestra si nunca se vio", () => {
    expect(shouldShowPrimerUso({ stored: null, automated: false })).toBe(true);
  });

  it("no se muestra si ya se terminó o salteó", () => {
    expect(shouldShowPrimerUso({ stored: PRIMER_USO_DONE, automated: false })).toBe(false);
  });

  it("un valor guardado raro cuenta como no visto, no rompe", () => {
    expect(shouldShowPrimerUso({ stored: "???", automated: false })).toBe(true);
  });

  it("no se muestra en navegadores automatizados salvo que se fuerce", () => {
    expect(shouldShowPrimerUso({ stored: null, automated: true })).toBe(false);
    expect(shouldShowPrimerUso({ stored: null, automated: true, forced: true })).toBe(true);
    expect(shouldShowPrimerUso({ stored: PRIMER_USO_DONE, automated: true, forced: true })).toBe(
      false,
    );
  });

  it("el paso no se sale del rango", () => {
    expect(clampStep(-1, 4)).toBe(0);
    expect(clampStep(9, 4)).toBe(3);
    expect(clampStep(2, 4)).toBe(2);
    expect(clampStep(1, 0)).toBe(0);
  });
});
