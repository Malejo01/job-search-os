import { describe, expect, it } from "vitest";
import roleSkillsSeed from "../../../db/seeds/role_skills.json";
import skills from "../../../db/seeds/skills.json";
import { compileTaxonomy, extractSkillsFromText } from "./match";
import {
  COMMUNICATION_ROLE_KEYS,
  LEGAL_MANAGEMENT_ROLE_KEYS,
  MAX_ROLE_SKILLS,
  MIN_ROLE_SKILLS,
  ROLE_GROUPS,
  ROLE_KEYS,
  UNLISTED_ROLE_KEYS,
  defaultRole,
  roleSkillsSchema,
  selectableRoleGroups,
  type RoleKey,
} from "./self-assessment";

/** Carreras de la beta (C1-2, ADR-027): claves, rótulos, grupos y skills. */

const roleSkills = roleSkillsSchema.parse(roleSkillsSeed);
const taxonomy = skills as { slug: string; category: string }[];
const extract = (text: string) => extractSkillsFromText(text, compileTaxonomy(skills)).sort();

const NEW_KEYS: RoleKey[] = [
  "abogacia",
  "administracion_empresas",
  "comunicacion",
  "relaciones_internacionales",
];

describe("claves y grupos", () => {
  it("las 4 claves van al final de ROLE_KEYS, en ese orden", () => {
    expect(ROLE_KEYS.slice(-4)).toEqual(NEW_KEYS);
    expect(ROLE_KEYS.slice(20, 22)).toEqual(["finanzas_contabilidad", "asistencia_operaciones"]);
  });

  it("dos grupos nuevos al final del selector, sin mover las carreras que ya estaban", () => {
    expect(ROLE_GROUPS.slice(-2)).toEqual([
      { label: "Derecho, contabilidad y gestión", roles: ["abogacia", "administracion_empresas"] },
      { label: "Comunicación y relaciones", roles: ["comunicacion", "relaciones_internacionales"] },
    ]);
    expect(LEGAL_MANAGEMENT_ROLE_KEYS).toEqual(["abogacia", "administracion_empresas"]);
    expect(COMMUNICATION_ROLE_KEYS).toEqual(["comunicacion", "relaciones_internacionales"]);
    const flat = (label: string) => ROLE_GROUPS.find((g) => g.label === label)!.roles;
    expect(flat("Finanzas y operaciones")).toEqual([
      "finanzas_contabilidad",
      "asistencia_operaciones",
    ]);
    expect(flat("Carreras digitales")).toContain("marketing_digital");
  });

  it("salen sin listar hasta medir volumen (ADR-022 §7), pero las conserva quien las tiene", () => {
    for (const k of NEW_KEYS) expect(UNLISTED_ROLE_KEYS).toContain(k);
    const ids = (keep: RoleKey[]) => selectableRoleGroups(keep).flatMap((g) => [...g.roles]);
    for (const k of NEW_KEYS) {
      expect(ids([])).not.toContain(k);
      expect(ids([k])).toContain(k);
    }
    const labels = selectableRoleGroups().map((g) => g.label);
    expect(labels).not.toContain("Derecho, contabilidad y gestión");
    expect(labels).not.toContain("Comunicación y relaciones");
  });
});

describe("rótulos", () => {
  it.each([
    ["abogacia", "Abogacía y legales"],
    ["administracion_empresas", "Administración de empresas"],
    ["comunicacion", "Comunicación y prensa"],
    ["relaciones_internacionales", "Relaciones internacionales y comex"],
    ["finanzas_contabilidad", "Contaduría, impuestos y finanzas"],
    ["marketing_digital", "Marketing y relaciones públicas"],
  ] as [RoleKey, string][])("%s → %s", (role, label) => {
    expect(roleSkills[role].label).toBe(label);
  });
});

describe("skills por carrera", () => {
  it.each(NEW_KEYS)("%s: entre 8 y 12 skills, todas en la taxonomía", (role) => {
    const list = roleSkills[role].skills;
    expect(list.length).toBeGreaterThanOrEqual(MIN_ROLE_SKILLS);
    expect(list.length).toBeLessThanOrEqual(MAX_ROLE_SKILLS);
    const known = new Set(taxonomy.map((s) => s.slug));
    for (const slug of list) expect(known.has(slug), `${role}: ${slug}`).toBe(true);
  });

  it.each(NEW_KEYS)("%s: al menos 6 skills propias (no reusadas de otras carreras)", (role) => {
    const others = new Set(
      ROLE_KEYS.filter((r) => r !== role).flatMap((r) => roleSkills[r].skills),
    );
    const own = roleSkills[role].skills.filter((s) => !others.has(s));
    expect(own.length, role).toBeGreaterThanOrEqual(6);
  });

  it("las 30 skills nuevas son de dominio", () => {
    const owned = NEW_KEYS.flatMap((r) => roleSkills[r].skills);
    const fresh = taxonomy.filter((s) => owned.includes(s.slug) && s.category === "dominio");
    expect(fresh.length).toBeGreaterThanOrEqual(30);
  });

  it.each([
    ["contract_drafting", "Redacción y revisión de contratos comerciales."],
    ["corporate_law", "Experiencia en derecho societario y sociedades comerciales."],
    ["labor_law", "Conocimientos de derecho laboral."],
    ["litigation", "Litigio y escritos judiciales en tribunales."],
    ["aml_compliance", "Prevención de lavado de activos y KYC."],
    ["data_privacy", "Protección de datos personales y GDPR."],
    ["ip_law", "Registro de marcas y propiedad intelectual."],
    ["procurement", "Gestión de compras y de proveedores, órdenes de compra."],
    ["supply_chain", "Cadena de suministro y planificación de la demanda."],
    ["process_improvement", "Mejora continua con Six Sigma."],
    ["management_control", "Control de gestión y tableros de control."],
    ["press_relations", "Redacción de gacetillas y relaciones con medios."],
    ["corporate_communications", "Comunicación institucional y comunicación interna."],
    ["journalism", "Periodismo digital y fact checking."],
    ["foreign_trade", "Comercio exterior: importaciones, exportaciones e incoterms."],
    ["international_cooperation", "Cooperación internacional y marco lógico."],
    ["grant_writing", "Grant writing y captación de fondos."],
    ["public_affairs", "Government affairs y relaciones institucionales."],
    ["trade_agreements", "Seguimiento del Mercosur y acuerdos comerciales."],
  ])("detecta %s en: %s", (slug, text) => {
    expect(extract(text)).toContain(slug);
  });

  it.each([
    ["aml_compliance", "We keep SOC 2 compliance and run quarterly audits."],
    ["data_privacy", "Backups y protección de datos del servidor."],
    ["ip_law", "Copyright 2024 Acme Inc. All rights reserved."],
    ["global_mobility", "We offer visa sponsorship and relocation support."],
    ["pricing", "Build the checkout flow with Stripe."],
    ["supply_chain", "Deploy the chain of services with Kubernetes."],
  ])("no marca %s en: %s", (slug, text) => {
    expect(extract(text)).not.toContain(slug);
  });
});

describe("defaultRole: titulares de las carreras de la beta", () => {
  const role = (headline: string) =>
    defaultRole({ headline, allowedDisciplines: null, defaultDisciplines: [] });

  it.each([
    ["Abogada laboralista", "abogacia"],
    ["Paralegal | derecho corporativo", "abogacia"],
    ["Licenciada en Administración de Empresas", "administracion_empresas"],
    ["Periodista y comunicadora social", "comunicacion"],
    ["Responsable de comunicación interna", "comunicacion"],
    ["Analista de comercio exterior", "relaciones_internacionales"],
    ["Licenciado en Relaciones Internacionales", "relaciones_internacionales"],
    ["Relacionista público | RRPP", "marketing_digital"],
    ["Contadora pública", "finanzas_contabilidad"],
  ] as [string, RoleKey][])("%s → %s", (headline, expected) => {
    expect(role(headline)).toBe(expected);
  });

  it("no cambia lo de antes", () => {
    expect(role("Senior Frontend Developer")).toBe("frontend");
    expect(role("Community Manager")).toBe("marketing_digital");
    expect(role("Recursos humanos")).toBe("rrhh_it");
    expect(role("Soy muy curiosa")).toBeNull();
  });
});
