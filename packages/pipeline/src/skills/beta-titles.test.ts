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

describe("Abogacía y legales", () => {
  it.each([
    "Abogado/a Corporativo",
    "Abogada Laboralista",
    "Asesor Legal",
    "Analista Legal Jr",
    "Procurador",
    "Paralegal",
    "Asistente Legal",
    "Legal Counsel",
    "Corporate Counsel",
    "Legal Analyst",
    "Contracts Counsel",
    "Contract Manager",
    "Analista de Contratos",
    "Compliance Officer",
    "Oficial de Cumplimiento",
    "Privacy Counsel",
    "IP Associate",
    "Trademark Paralegal",
    "Legal Operations Manager",
  ])("%s es de la carrera", (title) => {
    expect(is(title, "abogacia")).toBe(true);
  });

  it.each([
    "Legal Engineer",
    "Legal Software Developer",
    "Legal Nurse Consultant",
    "Legal Interpreter",
    "Legal Translator",
    "Traductor Jurado Legal",
    "Legal Sales Representative",
    "Security Compliance Officer",
    "IT Compliance Officer",
    "SOC Compliance Officer",
    "Pharma Compliance Officer",
    "Regulatory Affairs Compliance Officer",
    "Privacy Engineer",
    "Analista de Relaciones Laborales",
    "Contract Specialist",
    "Legal Assistant to the CEO",
  ])("%s no es de la carrera", (title) => {
    expect(is(title, "abogacia")).toBe(false);
  });

  it("«legal» y «contract» sueltos no alcanzan", () => {
    expect(hints("Legal")).not.toContain("abogacia");
    expect(hints("Contract Administrator")).not.toContain("abogacia");
  });

  it("la exclusión de «compliance officer» no anula a un abogado del mismo título", () => {
    expect(is("Abogado y Security Compliance Officer", "abogacia")).toBe(true);
  });
});
