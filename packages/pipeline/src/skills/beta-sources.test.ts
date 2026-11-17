import { describe, expect, it } from "vitest";
import { inferRoleHints, SOURCE_CATEGORY_ROLES } from "./role-hints";

/** Categorías no técnicas de Jobicy y We Work Remotely (C1-6, ADR-027). Todo inventado. */
const fromCategory = (sourceKind: string, category: string, title = "Specialist") =>
  inferRoleHints({ sourceKind, title, categories: [category] });

describe("Jobicy", () => {
  it.each([
    ["legal", ["abogacia"]],
    ["accounting-finance", ["finanzas_contabilidad"]],
    ["marketing", ["marketing_digital"]],
    ["copywriting", ["marketing_digital", "comunicacion"]],
    ["management", ["administracion_empresas"]],
    ["business", ["administracion_empresas"]],
    ["project-management", ["project_manager", "administracion_empresas"]],
    ["admin-support", ["asistencia_operaciones"]],
  ])("%s → %j", (category, roles) => {
    expect(fromCategory("jobicy", category)).toEqual(roles);
  });

  it("la categoría «admin» es de DevOps/sistemas y no se mapea a ninguna carrera de oficina", () => {
    expect(Object.hasOwn(SOURCE_CATEGORY_ROLES.jobicy!, "admin")).toBe(false);
    expect(fromCategory("jobicy", "admin")).toEqual([]);
    expect(fromCategory("jobicy", "Admin & Support")).toEqual(["asistencia_operaciones"]);
  });

  it("lo que ya estaba mapeado no cambia", () => {
    expect(fromCategory("jobicy", "hr")).toEqual(["rrhh_it"]);
    expect(fromCategory("jobicy", "customer-success")).toEqual(["customer_success"]);
    expect(fromCategory("jobicy", "product")).toEqual(["product_manager", "product_owner"]);
    expect(fromCategory("jobicy", "devops")).toEqual(["soporte_it"]);
  });

  it("el título decide: un título técnico con categoría legal no suma abogacía por título", () => {
    // La categoría da el hint; titleFit lo veta después (ver pool/beta-title-fit.test.ts).
    expect(fromCategory("jobicy", "legal", "Legal Software Engineer")).toContain("abogacia");
  });
});

describe("We Work Remotely", () => {
  it("Sales and Marketing sigue dando marketing por la categoría", () => {
    expect(fromCategory("wwr", "remote-sales-and-marketing-jobs")).toEqual(["marketing_digital"]);
    expect(fromCategory("wwr", "Sales and Marketing")).toEqual(["marketing_digital"]);
  });

  // R11-9: Management and Finance trae de todo; sin señal en el título no asigna carrera.
  it.each([
    "remote-management-and-finance-jobs",
    "Management and Finance",
    "remote-business-exec-management-jobs",
    "remote-finance-and-legal-jobs",
  ])("%s: una categoría amplia sola no alcanza", (category) => {
    expect(fromCategory("wwr", category)).toEqual([]);
  });

  it.each([
    ["Technical Recruiter"],
    ["Senior Recruiter, Engineering"],
    ["Loan Officer"],
    ["Mortgage Loan Officer"],
    ["AI Consultant"],
    ["Generative AI Strategy Consultant"],
    ["Customer Onboarding Lead"],
  ])("«%s» en Management and Finance no va a Contaduría", (title) => {
    expect(fromCategory("wwr", "remote-management-and-finance-jobs", title)).not.toContain(
      "finanzas_contabilidad",
    );
  });

  it("un recruiter queda en RR.HH. por el título, no en Contaduría ni en Administración", () => {
    expect(
      fromCategory("wwr", "remote-management-and-finance-jobs", "Technical Recruiter"),
    ).toEqual(["rrhh_it"]);
  });

  it.each([
    ["Staff Accountant", "finanzas_contabilidad"],
    ["Payroll Specialist", "finanzas_contabilidad"],
    ["Accounts Payable Clerk", "finanzas_contabilidad"],
    ["Analista Administrativo", "administracion_empresas"],
    ["Procurement Analyst", "administracion_empresas"],
  ])("«%s» con la categoría y el título del puesto sí va a su carrera", (title, role) => {
    expect(fromCategory("wwr", "remote-management-and-finance-jobs", title)).toContain(role);
  });

  it("las demás fuentes no cambian: Jobicy accounting-finance sigue siendo contaduría por categoría", () => {
    expect(fromCategory("jobicy", "accounting-finance", "Specialist")).toEqual([
      "finanzas_contabilidad",
    ]);
  });

  it("no mapea ventas puras: Sales and Marketing no da ventas_b2b", () => {
    expect(fromCategory("wwr", "remote-sales-and-marketing-jobs")).not.toContain("ventas_b2b");
  });

  it("lo que ya estaba mapeado no cambia", () => {
    expect(fromCategory("wwr", "remote-customer-support-jobs")).toEqual([
      "customer_success",
      "atencion_cliente",
    ]);
    expect(fromCategory("wwr", "remote-product-jobs")).toEqual([
      "product_manager",
      "product_owner",
      "project_manager",
    ]);
  });
});
