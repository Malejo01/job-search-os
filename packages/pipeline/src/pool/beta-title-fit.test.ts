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

describe("titleFit · relaciones internacionales", () => {
  it.each([
    ["Analista de Comercio Exterior", 2],
    ["International Sales Representative", 0],
    ["Data Analyst, International", 0],
    ["Coordinador Internacional", 1],
  ] as [string, number][])("%s → %i", (title, fit) => {
    expect(titleFit(title, "relaciones_internacionales")).toBe(fit);
  });

  it("un título con frase propia nunca se veta", () => {
    expect(titleFit("Foreign Trade Data Specialist", "relaciones_internacionales")).toBe(2);
  });
});

describe("titleFit · categorías compartidas de las fuentes (C1-6)", () => {
  it.each([
    ["Accountant", "administracion_empresas", 0],
    ["Financial Analyst", "administracion_empresas", 0],
    ["Account Executive", "administracion_empresas", 0],
    ["Business Development Representative", "administracion_empresas", 0],
    ["Analista de Control de Gestión", "administracion_empresas", 2],
    ["Operations Manager", "finanzas_contabilidad", 1],
    ["Procurement Analyst", "finanzas_contabilidad", 0],
    ["Account Executive", "marketing_digital", 0],
    ["Sales Manager", "marketing_digital", 0],
    ["SEO Specialist", "marketing_digital", 2],
    ["Digital Marketing Manager", "marketing_digital", 2],
    ["Marketing Specialist", "marketing_digital", 1],
  ] as [string, RoleKey, number][])("%s · %s → %i", (title, role, fit) => {
    expect(titleFit(title, role)).toBe(fit);
  });
});
