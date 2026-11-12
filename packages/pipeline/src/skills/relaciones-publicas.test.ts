import { describe, expect, it } from "vitest";
import criteria from "../../../db/seeds/criteria.example.json";
import roleSkillsSeed from "../../../db/seeds/role_skills.json";
import skills from "../../../db/seeds/skills.json";
import type { CriteriaRules } from "../criteria";
import { parsePoolMailbox } from "../pool/mailbox";
import { prefilter } from "../prefilter/prefilter";
import { inferRoleHints, matchesRoleTitle, normalizeTitleText } from "./role-hints";
import {
  BETA_LAUNCH_ROLE_KEYS,
  MAX_ROLE_SKILLS,
  MIN_ROLE_SKILLS,
  ROLE_KEYS,
  defaultRole,
  isRoleKey,
  roleSkillsSchema,
  waitlistRoleGroups,
  type RoleKey,
} from "./self-assessment";
import { specialtiesFor, specialtyIdsForTitle } from "./specialties";

/**
 * Relaciones públicas como carrera propia (C3, ADR-033). Todo inventado: títulos genéricos, sin avisos
 * reales ni empresas.
 */
const is = (title: string, role: RoleKey) => matchesRoleTitle(normalizeTitleText(title), role);
const hints = (title: string) => inferRoleHints({ sourceKind: "other", title });
const roleSkills = roleSkillsSchema.parse(roleSkillsSeed);
const taxonomy = new Set((skills as { slug: string }[]).map((s) => s.slug));

describe("clave relaciones_publicas", () => {
  it("existe, va al final de ROLE_KEYS y se valida", () => {
    expect(isRoleKey("relaciones_publicas")).toBe(true);
    expect(ROLE_KEYS.at(-1)).toBe("relaciones_publicas");
  });

  it("tiene rótulo, entre 8 y 12 skills y todas están en la taxonomía", () => {
    const entry = roleSkills.relaciones_publicas;
    expect(entry.label).toBe("Relaciones públicas");
    expect(entry.skills.length).toBeGreaterThanOrEqual(MIN_ROLE_SKILLS);
    expect(entry.skills.length).toBeLessThanOrEqual(MAX_ROLE_SKILLS);
    for (const slug of entry.skills) expect(taxonomy.has(slug), slug).toBe(true);
  });

  it("marketing ya no se rotula con relaciones públicas", () => {
    expect(roleSkills.marketing_digital.label).toBe("Marketing digital");
  });
});

describe("las 8 carreras de la beta", () => {
  it("BETA_LAUNCH_ROLE_KEYS tiene las 8, en el orden del anuncio", () => {
    expect(BETA_LAUNCH_ROLE_KEYS).toEqual([
      "abogacia",
      "finanzas_contabilidad",
      "administracion_empresas",
      "comunicacion",
      "marketing_digital",
      "relaciones_publicas",
      "relaciones_internacionales",
      "fullstack",
    ]);
  });

  it("el selector de /acceso las muestra primero, sin repetirlas en el resto", () => {
    const groups = waitlistRoleGroups();
    expect(groups[0]).toEqual({ label: "Carreras de la beta", roles: BETA_LAUNCH_ROLE_KEYS });
    const rest = groups.slice(1).flatMap((g) => [...g.roles]);
    for (const key of BETA_LAUNCH_ROLE_KEYS) expect(rest).not.toContain(key);
  });
});

describe("títulos de relaciones públicas", () => {
  it.each([
    "Ejecutiva de RRPP",
    "Ejecutivo de RR.PP.",
    "Ejecutivo/a de RRPP",
    "Relacionista Público",
    "PR Specialist",
    "PR Executive",
    "PR Manager",
    "Responsable de Relaciones Públicas",
    "Public Relations Coordinator",
    "Public Affairs Manager",
    "Analista de Relaciones Institucionales",
    "Organizador de Eventos",
    "Organizador/a de Eventos",
    "Events Coordinator",
    "Analista de RSE",
    "CSR Analyst",
  ])("%s es de la carrera", (title) => {
    expect(is(title, "relaciones_publicas")).toBe(true);
    expect(hints(title)).toContain("relaciones_publicas");
  });

  it.each([
    "RRPP para boliche",
    "Relaciones Públicas - Fiesta Nocturna",
    "RRPP con entradas y comisión",
    "Promotor de Relaciones Públicas",
    "Desarrollador Backend",
    "Contador Público",
  ])("%s no es de la carrera", (title) => {
    expect(is(title, "relaciones_publicas")).toBe(false);
  });

  it("marketing deja de reclamar los títulos de RR.PP., pero conserva los suyos", () => {
    for (const t of ["Ejecutiva de RRPP", "PR Specialist", "Relacionista Público"]) {
      expect(is(t, "marketing_digital"), t).toBe(false);
      expect(hints(t), t).not.toContain("marketing_digital");
    }
    for (const t of ["SEO Specialist", "Brand Manager", "Media Planner", "Community Manager"]) {
      expect(is(t, "marketing_digital"), t).toBe(true);
      expect(is(t, "relaciones_publicas"), t).toBe(false);
    }
  });

  it("«Relaciones Institucionales» sigue sumando hint en relaciones internacionales", () => {
    expect(hints("Relaciones Institucionales")).toEqual(
      expect.arrayContaining(["relaciones_publicas", "relaciones_internacionales"]),
    );
  });

  it("los titulares de la persona se reconocen", () => {
    const role = (headline: string) =>
      defaultRole({ headline, allowedDisciplines: null, defaultDisciplines: [] });
    expect(role("Relacionista público | RRPP")).toBe("relaciones_publicas");
    expect(role("Licenciada en Relaciones Públicas")).toBe("relaciones_publicas");
    expect(role("Community Manager")).toBe("marketing_digital");
  });
});

describe("especialidades de relaciones públicas", () => {
  it("tiene sus chips y marketing ya no los lleva", () => {
    const ids = specialtiesFor("relaciones_publicas").map((c) => c.id);
    expect(ids).toEqual([
      "relaciones_publicas_y_prensa",
      "eventos_y_ceremonial",
      "relaciones_institucionales",
      "rse_y_sustentabilidad",
    ]);
    const marketing = specialtiesFor("marketing_digital").map((c) => c.id);
    for (const id of ids) expect(marketing).not.toContain(id);
  });

  it("un título de eventos cae en el chip de eventos", () => {
    expect(specialtyIdsForTitle("Organizador de Eventos", "relaciones_publicas")).toEqual([
      "eventos_y_ceremonial",
    ]);
  });
});

describe("casilla del pool", () => {
  const opts = { ingestDomain: "ingest.ejemplo.test", careers: ROLE_KEYS };
  it("pool-relaciones_publicas y pool-fullstack son casillas válidas", () => {
    expect(parsePoolMailbox("pool-relaciones_publicas@ingest.ejemplo.test", opts)).toEqual({
      ok: true,
      career: "relaciones_publicas",
    });
    expect(parsePoolMailbox("pool-fullstack@ingest.ejemplo.test", opts)).toEqual({
      ok: true,
      career: "fullstack",
    });
  });
});

describe("prefiltro con relaciones públicas", () => {
  // Las reglas del ejemplo bloquean «manager»
  const rules = criteria as CriteriaRules;
  const run = (title: string, targetRoles?: RoleKey[]) =>
    prefilter(
      { title, modality: "remoto", locationRaw: "Remoto" },
      rules,
      targetRoles ? { targetRoles } : {},
    );

  it("«PR Manager» pasa con la carrera y se bloquea sin ella", () => {
    expect(run("PR Manager", ["relaciones_publicas"]).pass).toBe(true);
    expect(run("PR Manager")).toMatchObject({ pass: false, reason: "titulo_blocklist" });
    expect(run("PR Manager", ["backend"])).toMatchObject({ pass: false });
  });

  it("la frase libera «manager», no el resto de la blocklist", () => {
    expect(run("Director de PR Manager", ["relaciones_publicas"])).toMatchObject({ pass: false });
    expect(run("Operations Manager", ["relaciones_publicas"])).toMatchObject({ pass: false });
  });

  it("«Brand Manager» sigue siendo de marketing, no de relaciones públicas", () => {
    expect(run("Brand Manager", ["marketing_digital"]).pass).toBe(true);
    expect(run("Brand Manager", ["relaciones_publicas"])).toMatchObject({ pass: false });
  });
});
