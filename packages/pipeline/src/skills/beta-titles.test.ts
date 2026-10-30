import { describe, expect, it } from "vitest";
import { inferRoleHints, matchesRoleTitle, normalizeTitleText } from "./role-hints";
import type { RoleKey } from "./self-assessment";

/**
 * Títulos de las seis carreras de la beta (C1-3, ADR-027). Cada carrera tiene sus positivos, sus
 * falsos positivos conocidos y sus vetos. Todo inventado.
 */
const is = (title: string, role: RoleKey) => matchesRoleTitle(normalizeTitleText(title), role);
const hints = (title: string) => inferRoleHints({ sourceKind: "other", title });

describe("Contaduría, impuestos y finanzas", () => {
  it.each([
    "Liquidador de Sueldos",
    "Liquidadora de Sueldos Jr",
    "Analista de Sueldos y Jornales",
    "Liquidación de Haberes",
    "Analista de Costos",
    "Auditoría Interna",
    "Analista de Control Interno",
    "Analista de Créditos y Cobranzas",
    "Analista de Cuentas Corrientes",
    "Perito Contable",
    "Analista Impositivo",
    "Contador Público",
    "Staff Accountant",
    "Internal Auditor",
    "FP&A Analyst",
    "Treasury Analyst",
    "Payroll Analyst",
    "Tax Associate",
    "AML Analyst",
  ])("%s es de la carrera", (title) => {
    expect(is(title, "finanzas_contabilidad")).toBe(true);
  });

  it.each([
    "Vendedor - sueldo + comisiones",
    "Auditor de Calidad ISO 9001",
    "Quality Auditor",
    "Auditoría de Obra",
    "Auditor de Higiene y Seguridad",
    "Auditor de Llamadas Call Center",
    "Auditoría de Accesibilidad Web",
    "Auditor Médico",
    "Asesor Financiero - Seguros",
    "Asesor Financiero con comisión",
    "Liquidador de Siniestros",
    "Perito Mecánico",
    "Perito Calígrafo",
    "Perito Tasador",
    "Analista de Cobranzas Call Center",
    "IT Auditor",
    "Auditoría de Sistemas",
  ])("%s no es de la carrera", (title) => {
    expect(is(title, "finanzas_contabilidad")).toBe(false);
  });

  it("un auditor de calidad no anula a un contador con el mismo título", () => {
    expect(is("Contador y Auditor de Calidad", "finanzas_contabilidad")).toBe(true);
  });

  it("suma el hint en inferRoleHints", () => {
    expect(hints("Liquidador de Sueldos")).toContain("finanzas_contabilidad");
    expect(hints("Auditor de Calidad ISO")).not.toContain("finanzas_contabilidad");
  });
});
