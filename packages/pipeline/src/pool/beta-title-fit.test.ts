import { describe, expect, it } from "vitest";
import type { RoleKey } from "../skills/self-assessment";
import { titleFit } from "./title-fit";

/** Vetos entre carreras de la beta (C1-3, ADR-027). Un título con frase propia nunca se veta. */
describe("titleFit · carreras de la beta", () => {
  it.each([
    ["Abogado Corporativo", "abogacia", 2],
    ["Legal Counsel", "abogacia", 2],
    ["Legal Software Specialist", "abogacia", 0],
    ["Analista de Sistemas Legales", "abogacia", 0],
    ["Legal Operations Engineer", "abogacia", 0],
    ["Asesor", "abogacia", 1],
  ] as [string, RoleKey, number][])("%s · %s → %i", (title, role, fit) => {
    expect(titleFit(title, role)).toBe(fit);
  });
});

describe("titleFit · administración de empresas", () => {
  it.each([
    ["Analista de Compras", 2],
    ["Analista de Sistemas", 0],
    ["Software Procurement Tools", 0],
    ["Coordinador", 1],
  ] as [string, number][])("%s → %i", (title, fit) => {
    expect(titleFit(title, "administracion_empresas")).toBe(fit);
  });
});

describe("titleFit · comunicación", () => {
  it.each([
    ["Periodista", 2],
    ["Telecom Specialist", 0],
    ["Ingeniero de Redes", 0],
    ["Analista", 1],
  ] as [string, number][])("%s → %i", (title, fit) => {
    expect(titleFit(title, "comunicacion")).toBe(fit);
  });
});
