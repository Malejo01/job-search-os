import { describe, expect, it } from "vitest";
import { isEntryLevel } from "./entry-level";

describe("isEntryLevel (R30-05, «Para empezar»)", () => {
  it("la columna de nivel del aviso manda", () => {
    expect(isEntryLevel("Junior", "Desarrollador")).toBe(true);
    expect(isEntryLevel("Trainee", "Analista")).toBe(true);
    expect(isEntryLevel("Entry level", "Analyst")).toBe(true);
  });

  it("sin columna, el nivel que declara el título", () => {
    expect(isEntryLevel(null, "Desarrollador Jr")).toBe(true);
    expect(isEntryLevel(null, "Pasante de marketing")).toBe(true);
    expect(isEntryLevel("Any", "Junior Data Analyst")).toBe(true);
  });

  it("con varios niveles vale el más bajo", () => {
    expect(isEntryLevel("Junior / Semi Senior", "Developer")).toBe(true);
  });

  it("semi senior, senior o lead no son para empezar", () => {
    expect(isEntryLevel("Semi Senior", "Developer")).toBe(false);
    expect(isEntryLevel(null, "Senior Developer")).toBe(false);
    expect(isEntryLevel(null, "Lead Designer")).toBe(false);
  });

  it("sin señal, no entra: nunca se deduce de los años ni del salario", () => {
    expect(isEntryLevel(null, "Desarrollador Backend")).toBe(false);
    expect(isEntryLevel("", "")).toBe(false);
  });
});
