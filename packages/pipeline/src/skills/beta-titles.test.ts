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

describe("Administración de empresas", () => {
  it.each([
    "Analista Administrativo",
    "Analista Administrativa Contable",
    "Jefe de Administración",
    "Jefa de Administración y Finanzas",
    "Responsable Administrativo",
    "Analista de Control de Gestión",
    "Comprador",
    "Compradora Senior",
    "Analista de Compras",
    "Buyer",
    "Procurement Analyst",
    "Analista de Logística",
    "Supply Chain Analyst",
    "Demand Planner",
    "Analista de Procesos",
    "Process Improvement Analyst",
    "Analista Comercial",
    "Pricing Analyst",
    "Analista de Estrategia",
    "Management Consultant",
  ])("%s es de la carrera", (title) => {
    expect(is(title, "administracion_empresas")).toBe(true);
  });

  it.each([
    "Administrador de Sistemas",
    "Administrador de Base de Datos",
    "Administradora de Consorcios",
    "Administrador",
    "Business Analyst SAP",
    "Business Analyst IT",
    "Process Engineer",
    "Analista de Procesos Químicos",
    "Analista de Procesos de Planta",
    "Encargado de Local",
    "Encargada de Sucursal",
    "Jefe de Sucursal y Analista Administrativo",
    "Media Buyer",
    "Real Estate Buyer",
  ])("%s no es de la carrera", (title) => {
    expect(is(title, "administracion_empresas")).toBe(false);
  });

  it("es la más genérica: un título puede sumar también otra carrera, no solo esta", () => {
    expect(hints("Analista Administrativo")).toContain("administracion_empresas");
    expect(hints("Analista de Control de Gestión")).toEqual(
      expect.arrayContaining(["administracion_empresas", "finanzas_contabilidad"]),
    );
  });
});

describe("Comunicación y prensa", () => {
  it.each([
    "Analista de Comunicación",
    "Responsable de Comunicación Institucional",
    "Comunicación Interna",
    "Internal Communications Manager",
    "Communications Specialist",
    "Communications Coordinator",
    "Communications Officer",
    "Jefe de Prensa",
    "Jefa de Prensa",
    "Responsable de Prensa",
    "Agente de Prensa",
    "Press Officer",
    "Media Relations Manager",
    "Periodista",
    "Periodista de redes sociales",
    "Redactor/a",
    "Editor",
    "Editora Digital",
    "Productor Periodístico",
    "Journalist",
    "Reporter",
    "Content Writer",
    "Content Editor",
    "UX Writer",
  ])("%s es de la carrera", (title) => {
    expect(is(title, "comunicacion")).toBe(true);
  });

  it.each([
    "Técnico en Telecomunicaciones",
    "Ingeniero de Telecomunicaciones",
    "Communications Engineer",
    "Analista de Comunicaciones Unificadas",
    "Unified Communications Specialist",
    "Network Communications Specialist",
    "Especialista en Comunicación por Radiofrecuencia",
    "Responsable de Redes de Datos y Comunicación",
    "Técnico de Fibra Óptica",
    "Operario de Prensa Hidráulica",
    "Responsable de Prensa de Inyección",
    "Jefe de Prensa Matricería",
    "Emergency Communications Officer",
    "911 Communications Specialist",
    "Dispatch Communications Coordinator",
    "Moderador de Contenido",
    "Content Moderator / Content Writer",
    "Video Editor",
    "Editor de Video",
    "Photo Editor",
    "Court Reporter",
    "Analista de Medios de Pago",
    "Tele Operador",
  ])("%s no es de la carrera", (title) => {
    expect(is(title, "comunicacion")).toBe(false);
  });

  it("«prensista» y «prensa» industrial no suman la carrera", () => {
    expect(hints("Prensista")).not.toContain("comunicacion");
    expect(hints("Operario de Prensa")).not.toContain("comunicacion");
  });
});

describe("Marketing y relaciones públicas", () => {
  it.each([
    "Brand Manager",
    "Assistant Brand Manager",
    "Asistente de Marca",
    "Trade Marketing Analyst",
    "Market Research Analyst",
    "Insights Analyst",
    "Analista de Investigación de Mercado",
    "CRM Specialist",
    "Analista de CRM",
    "Media Planner",
    "Planificador de Medios",
    "Ejecutiva de RRPP",
    "Ejecutivo de RR.PP.",
    "Relacionista Público",
    "PR Specialist",
    "PR Executive",
    "Public Affairs Manager",
    "Responsable de Relaciones Públicas",
    "Organizador de Eventos",
    "Events Coordinator",
    "Analista de RSE",
    "CSR Analyst",
  ])("%s es de la carrera", (title) => {
    expect(is(title, "marketing_digital")).toBe(true);
  });

  it.each([
    "RRPP para boliche",
    "Relaciones Públicas - Fiesta Nocturna",
    "RRPP con entradas y comisión",
    "Promotor de Relaciones Públicas",
    "Telemarketing",
    "Telemarketer",
    "Network Marketing",
    "Marketing Multinivel",
    "Marketing Engineer",
    "Marketing Technologist",
    "Brand Ambassador",
    "Embajadora de Marca",
    "Ejecutivo de Cuentas",
    "Ejecutivo de Cuentas - Agencia de Publicidad",
  ])("%s no es de la carrera", (title) => {
    expect(is(title, "marketing_digital")).toBe(false);
  });

  it("lo que ya era marketing sigue siéndolo", () => {
    for (const t of [
      "SEO Specialist",
      "Community Manager",
      "Copywriter",
      "Growth Marketing Lead",
    ]) {
      expect(is(t, "marketing_digital")).toBe(true);
    }
  });
});
