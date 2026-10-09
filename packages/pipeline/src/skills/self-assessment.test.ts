import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CRITERIA_RULES } from "../onboarding";
import {
  ROLE_KEYS,
  SELF_LEVELS,
  defaultRole,
  parseRemoveSlugs,
  parseSkillLevelsForm,
  roleSkillsSchema,
  suggestedSkills,
} from "./self-assessment";

const read = (file: string) => JSON.parse(readFileSync(resolve(__dirname, file), "utf8"));
const seed = read("../../../db/seeds/role_skills.json");
const taxonomy: { slug: string }[] = read("../../../db/seeds/skills.json");
const DEFAULTS = DEFAULT_CRITERIA_RULES.allowed_disciplines;

describe("SELF_LEVELS", () => {
  it("cuatro niveles con su texto exacto", () => {
    expect(SELF_LEVELS.map((l) => [l.level, l.label])).toEqual([
      [0, "nunca lo usé"],
      [1, "hice un tutorial o curso"],
      [2, "lo usé en un proyecto"],
      [3, "lo uso con soltura"],
    ]);
  });
});

describe("role_skills.json", () => {
  const parsed = roleSkillsSchema.safeParse(seed);
  it("valida contra el esquema", () => expect(parsed.success).toBe(true));
  it("tiene los 8 roles", () => expect(Object.keys(seed).sort()).toEqual([...ROLE_KEYS].sort()));
  it("todos los slugs existen en la taxonomía", () => {
    const known = new Set(taxonomy.map((s) => s.slug));
    for (const role of ROLE_KEYS) {
      for (const slug of seed[role].skills) expect(known.has(slug), `${role}: ${slug}`).toBe(true);
    }
  });
  it("sin repetidos y de 8 a 12 por rol", () => {
    for (const role of ROLE_KEYS) {
      const list: string[] = seed[role].skills;
      expect(new Set(list).size).toBe(list.length);
      expect(list.length).toBeGreaterThanOrEqual(8);
      expect(list.length).toBeLessThanOrEqual(12);
    }
  });
  it("el esquema rechaza menos de 8, más de 12 y repetidos", () => {
    const base = roleSkillsSchema.parse(seed);
    expect(
      roleSkillsSchema.safeParse({ ...base, qa: { label: "QA", skills: ["sql"] } }).success,
    ).toBe(false);
    const many = Array.from({ length: 13 }, (_, i) => `skill_${i}`);
    expect(roleSkillsSchema.safeParse({ ...base, qa: { label: "QA", skills: many } }).success).toBe(
      false,
    );
    const dup = Array.from({ length: 8 }, () => "sql");
    expect(roleSkillsSchema.safeParse({ ...base, qa: { label: "QA", skills: dup } }).success).toBe(
      false,
    );
  });
});

describe("suggestedSkills", () => {
  it("devuelve los slugs del rol en orden, en una copia", () => {
    const map = roleSkillsSchema.parse(seed);
    const list = suggestedSkills("frontend", map);
    expect(list).toEqual(map.frontend.skills);
    list.pop();
    expect(map.frontend.skills.length).toBeGreaterThan(list.length);
  });
});

describe("defaultRole", () => {
  const role = (headline: string | null, allowed: string[] = [...DEFAULTS]) =>
    defaultRole({ headline, allowedDisciplines: allowed, defaultDisciplines: DEFAULTS });

  it("deduce del titular sin mayúsculas ni acentos", () => {
    expect(role("Desarrolladora FRONTEND senior")).toBe("frontend");
    expect(role("Back-end developer")).toBe("backend");
    expect(role("Full Stack Engineer")).toBe("fullstack");
    expect(role("Fullstack")).toBe("fullstack");
    expect(role("QA Automation")).toBe("qa");
    expect(role("Tester manual")).toBe("qa");
    expect(role("Analista de Datos")).toBe("data_analyst");
    expect(role("Data Analyst")).toBe("data_analyst");
    expect(role("Soporte técnico")).toBe("soporte_it");
    expect(role("AI Engineer")).toBe("ai_engineer");
    expect(role("Ingeniera en IA")).toBe("ai_engineer");
    expect(role("Diseñador UX")).toBe("ux_ui");
    expect(role("Product designer UI")).toBe("ux_ui");
  });
  it("las palabras cortas van enteras", () => {
    expect(role("Quality Assurance Squad")).toBeNull();
    expect(role("Diseño")).toBeNull();
    expect(role("Guía de Serie")).toBeNull();
  });
  it("con dos coincidencias gana la que aparece antes", () => {
    expect(role("Backend con foco en IA")).toBe("backend");
    expect(role("IA y backend")).toBe("ai_engineer");
  });
  it("sin titular usa las disciplinas permitidas, en orden de prioridad", () => {
    expect(role(null, ["backend", "devops"])).toBe("backend");
    expect(role("", ["frontend", "backend"])).toBe("frontend");
    expect(role(null, ["backend", "ai_engineer"])).toBe("ai_engineer");
    expect(role(null, ["data"])).toBe("data_analyst");
  });
  it("el titular gana sobre las disciplinas", () => {
    expect(role("Frontend", ["backend"])).toBe("frontend");
  });
  it("ignora los criterios de fábrica", () => {
    expect(role(null)).toBeNull();
    expect(role("Persona curiosa", [...DEFAULTS].reverse())).toBeNull();
  });
  it("nada coincide: null", () => {
    expect(role(null, ["devops"])).toBeNull();
    expect(role(null, [])).toBeNull();
    expect(
      defaultRole({ headline: undefined, allowedDisciplines: null, defaultDisciplines: DEFAULTS }),
    ).toBeNull();
  });
});

describe("parseSkillLevelsForm", () => {
  it("devuelve los niveles respondidos y se salta los vacíos", () => {
    expect(
      parseSkillLevelsForm({ "level:sql": "3", "level:docker": "", "level:react": "0", otro: "x" }),
    ).toEqual({
      ok: true,
      entries: [
        { slug: "sql", level: 3 },
        { slug: "react", level: 0 },
      ],
    });
  });
  it("formulario vacío: ok sin filas", () => {
    expect(parseSkillLevelsForm({})).toEqual({ ok: true, entries: [] });
  });
  it("rechaza nivel fuera de rango o con formato raro, con el campo y sin el valor", () => {
    for (const bad of ["4", "-1", "1.5", "tres", "01"]) {
      const r = parseSkillLevelsForm({ "level:sql": bad });
      expect(r).toEqual({ ok: false, field: "level:sql" });
      expect(JSON.stringify(r)).not.toContain(bad === "4" ? '"4"' : `"${bad}"`);
    }
  });
  it("rechaza slugs con formato inválido sin devolverlos", () => {
    for (const key of ["level:SQL", "level:a b", "level:", "level:../x", "level:1abc"]) {
      const r = parseSkillLevelsForm({ [key]: "2" });
      expect(r).toEqual({ ok: false, field: "slug" });
    }
  });
  it("rechaza más de 60 entradas", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 61; i++) raw[`level:skill_${i}`] = "1";
    expect(parseSkillLevelsForm(raw)).toEqual({ ok: false, field: "niveles" });
    delete raw["level:skill_60"];
    expect(parseSkillLevelsForm(raw).ok).toBe(true);
  });
});

describe("parseRemoveSlugs", () => {
  it("deja los slugs válidos sin repetir", () => {
    expect(parseRemoveSlugs(["sql", "sql", "Bad Slug", "react"])).toEqual(["sql", "react"]);
  });
});
