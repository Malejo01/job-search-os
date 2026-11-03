import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CRITERIA_RULES } from "../onboarding";
import {
  BACKOFFICE_ROLE_KEYS,
  BETA_LAUNCH_ROLE_KEYS,
  BETA_ROLE_KEYS,
  COMMERCIAL_ROLE_KEYS,
  DIGITAL_ROLE_KEYS,
  LEGAL_MANAGEMENT_ROLE_KEYS,
  UNLISTED_ROLE_KEYS,
  profileRoleGroups,
  selectableRoleGroups,
  waitlistRoleGroups,
  type RoleKey,
  IT_ROLE_KEYS,
  MAX_SKILL_ENTRIES,
  PRODUCT_ROLE_KEYS,
  ROLE_GROUPS,
  toRoleKey,
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

describe("ROLE_GROUPS", () => {
  it("los grupos cubren ROLE_KEYS sin repetir", () => {
    const all = ROLE_GROUPS.flatMap((g) => [...g.roles]);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...ROLE_KEYS].sort());
  });
  it("tecnología son los 8 de siempre más 2 de la ronda 106, producto los 4 de la 97 y digitales el resto", () => {
    expect(IT_ROLE_KEYS).toEqual(ROLE_KEYS.slice(0, 8));
    expect(PRODUCT_ROLE_KEYS).toEqual(ROLE_KEYS.slice(12, 16));
    expect(COMMERCIAL_ROLE_KEYS).toEqual(["ventas_b2b", "atencion_cliente"]);
    // Digitales, producto y comerciales (ronda 107): todo lo que no es IT ni de la 106.
    expect([...DIGITAL_ROLE_KEYS].sort()).toEqual(
      [...ROLE_KEYS.slice(8, 16), ...ROLE_KEYS.slice(18)].sort(),
    );
    expect(DIGITAL_ROLE_KEYS).toEqual(expect.arrayContaining([...LEGAL_MANAGEMENT_ROLE_KEYS]));
    expect(ROLE_GROUPS[0]!.roles).toEqual([...ROLE_KEYS.slice(0, 8), ...ROLE_KEYS.slice(16, 18)]);
    expect(ROLE_GROUPS[0]!.roles.slice(-2)).toEqual(["data_engineer", "solutions_engineer"]);
    expect(ROLE_GROUPS.map((g) => g.label)).toEqual([
      "Tecnología",
      "Producto y proyectos",
      "Carreras digitales",
      "Ventas y atención",
      "Finanzas y operaciones",
      "Derecho, contabilidad y gestión",
      "Comunicación y relaciones",
    ]);
    expect(ROLE_GROUPS[3]!.roles).toEqual(["ventas_b2b", "atencion_cliente"]);
    expect(ROLE_GROUPS[1]!.roles).toEqual([
      "product_manager",
      "product_owner",
      "project_manager",
      "product_marketing",
    ]);
  });
  it("el orden de los puestos que ya existían no cambia y producto_proyectos no se elige", () => {
    expect(ROLE_KEYS.slice(0, 12)).toEqual([
      "frontend",
      "backend",
      "fullstack",
      "qa",
      "data_analyst",
      "soporte_it",
      "ai_engineer",
      "ux_ui",
      "marketing_digital",
      "rrhh_it",
      "customer_success",
      "ciberseguridad",
    ]);
    expect(ROLE_KEYS as readonly string[]).not.toContain("producto_proyectos");
  });
  it("C-2b / G2-1: asistencia_operaciones queda en operaciones y finanzas_contabilidad migra a derecho/contabilidad", () => {
    expect(ROLE_KEYS.slice(20, 22)).toEqual(["finanzas_contabilidad", "asistencia_operaciones"]);
    expect(BACKOFFICE_ROLE_KEYS).toEqual(["asistencia_operaciones"]);
    expect(ROLE_GROUPS).toHaveLength(7);
    expect(ROLE_GROUPS[4]).toEqual({
      label: "Finanzas y operaciones",
      roles: ["asistencia_operaciones"],
    });
    for (const k of BACKOFFICE_ROLE_KEYS) {
      expect(DIGITAL_ROLE_KEYS).toContain(k);
      expect(IT_ROLE_KEYS).not.toContain(k);
    }
  });
});

describe("selectableRoleGroups", () => {
  it("hoy están sin listar asistencia_operaciones y 3 de las 4 de la beta (abogacía ya se publicó): salen del selector salvo que las tenga el perfil", () => {
    expect(UNLISTED_ROLE_KEYS).toEqual([
      "asistencia_operaciones",
      "administracion_empresas",
      "comunicacion",
      "relaciones_internacionales",
    ]);
    const flat = (g: ReturnType<typeof selectableRoleGroups>) => g.flatMap((x) => [...x.roles]);
    expect(flat(selectableRoleGroups())).toContain("abogacia");
    expect(flat(selectableRoleGroups())).not.toContain("asistencia_operaciones");
    expect(flat(selectableRoleGroups())).toContain("finanzas_contabilidad");
    const kept = flat(selectableRoleGroups(["asistencia_operaciones"]));
    expect(kept).toContain("asistencia_operaciones");
  });

  it("la lista de espera ofrece las cuatro carreras de la beta aunque sigan ocultas", () => {
    const offered = selectableRoleGroups(BETA_ROLE_KEYS).flatMap((g) => g.roles);
    for (const key of BETA_ROLE_KEYS) expect(offered).toContain(key);
    expect(offered).not.toContain("asistencia_operaciones");
  });
  it("las no listadas salen salvo las del perfil (keep), y los grupos no quedan vacíos", () => {
    // La lista es una constante: se prueba el mecanismo con una copia temporal y se restaura.
    const unlisted = UNLISTED_ROLE_KEYS as RoleKey[];
    const original = [...unlisted];
    unlisted.push("ventas_b2b", "atencion_cliente");
    try {
      const flat = (g: ReturnType<typeof selectableRoleGroups>) => g.flatMap((x) => [...x.roles]);
      expect(flat(selectableRoleGroups())).not.toContain("atencion_cliente");
      expect(selectableRoleGroups().map((g) => g.label)).not.toContain("Ventas y atención");
      expect(flat(selectableRoleGroups(["atencion_cliente"]))).toContain("atencion_cliente");
      expect(flat(selectableRoleGroups(["atencion_cliente"]))).not.toContain("ventas_b2b");
      for (const g of selectableRoleGroups(["atencion_cliente"])) {
        expect(g.roles.length).toBeGreaterThan(0);
      }
    } finally {
      unlisted.length = 0;
      unlisted.push(...original);
    }
  });
});

describe("profileRoleGroups: lo que ve quien elige carrera en la beta (C5-1)", () => {
  const flat = (g: ReturnType<typeof profileRoleGroups>) => g.flatMap((x) => [...x.roles]);

  it("ofrece siempre las 6 carreras de la beta, también las que siguen sin listar", () => {
    const offered = flat(profileRoleGroups());
    for (const key of BETA_ROLE_KEYS) expect(offered).toContain(key);
    expect(offered).toContain("finanzas_contabilidad");
    expect(offered).toContain("marketing_digital");
  });

  it("no suma asistencia_operaciones (la otra no listada) salvo que la persona ya la tenga", () => {
    expect(flat(profileRoleGroups())).not.toContain("asistencia_operaciones");
    expect(flat(profileRoleGroups(["asistencia_operaciones"]))).toContain("asistencia_operaciones");
  });

  it("deja el selector público como estaba: las que siguen ocultas no vuelven a la lista general", () => {
    for (const key of BETA_ROLE_KEYS.filter((k) => UNLISTED_ROLE_KEYS.includes(k))) {
      expect(flat(selectableRoleGroups())).not.toContain(key);
    }
  });

  it("cada carrera sale en un solo grupo y los grupos no quedan vacíos", () => {
    const all = flat(profileRoleGroups(["asistencia_operaciones"]));
    expect(new Set(all).size).toBe(all.length);
    for (const g of profileRoleGroups()) expect(g.roles.length).toBeGreaterThan(0);
  });

  it("conserva el orden de los grupos de ROLE_GROUPS", () => {
    const labels = profileRoleGroups().map((g) => g.label);
    const base = ROLE_GROUPS.map((g) => g.label).filter((l) => labels.includes(l));
    expect(labels).toEqual(base);
  });
});

describe("toRoleKey", () => {
  it("traduce la clave vieja y valida", () => {
    expect(toRoleKey("producto_proyectos")).toBe("product_manager");
    expect(toRoleKey("product_owner")).toBe("product_owner");
    expect(toRoleKey("frontend")).toBe("frontend");
    expect(toRoleKey("x")).toBeNull();
    expect(toRoleKey("toString")).toBeNull();
    expect(toRoleKey(null)).toBeNull();
    expect(toRoleKey(3)).toBeNull();
  });
});

describe("role_skills.json", () => {
  const parsed = roleSkillsSchema.safeParse(seed);
  it("valida contra el esquema", () => expect(parsed.success).toBe(true));
  it("tiene los 26 roles", () => {
    expect(ROLE_KEYS).toHaveLength(26);
    expect(Object.keys(seed).sort()).toEqual([...ROLE_KEYS].sort());
  });
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
  it("deduce los puestos de carreras digitales", () => {
    expect(role("Especialista en Marketing Digital")).toBe("marketing_digital");
    expect(role("SEO Specialist")).toBe("marketing_digital");
    expect(role("Product Manager")).toBe("product_manager");
    expect(role("Gerente de Producto")).toBe("product_manager");
    expect(role("Product Owner")).toBe("product_owner");
    expect(role("Dueña de Producto")).toBe("product_owner");
    expect(role("Product Owner / Scrum Master")).toBe("product_owner");
    expect(role("Jefa de Proyectos")).toBe("project_manager");
    expect(role("Scrum Master")).toBe("project_manager");
    expect(role("Agile Coach")).toBe("project_manager");
    expect(role("Product Marketing Manager")).toBe("product_marketing");
    expect(role("Data Engineer")).toBe("data_engineer");
    expect(role("Ingeniera de Datos")).toBe("data_engineer");
    expect(role("Solutions Engineer")).toBe("solutions_engineer");
    expect(role("Sales Engineer")).toBe("solutions_engineer");
    expect(role("Ingeniero de Preventa")).toBe("solutions_engineer");
    expect(role("Sales Development Representative (SDR)")).toBe("ventas_b2b");
    expect(role("Account Executive")).toBe("ventas_b2b");
    expect(role("Ejecutiva Comercial")).toBe("ventas_b2b");
    expect(role("Customer Support Specialist")).toBe("atencion_cliente");
    expect(role("Atención al cliente")).toBe("atencion_cliente");
    expect(role("Agente de Call Center")).toBe("atencion_cliente");
    expect(role("Tech Recruiter")).toBe("rrhh_it");
    expect(role("Reclutadora IT")).toBe("rrhh_it");
    expect(role("Analista de RRHH")).toBe("rrhh_it");
    expect(role("Customer Success Manager")).toBe("customer_success");
    expect(role("Analista de Ciberseguridad")).toBe("ciberseguridad");
    expect(role("Seguridad informática")).toBe("ciberseguridad");
  });
  it("C-2b: deduce finanzas y asistencia/operaciones del titular", () => {
    expect(role("Contadora Pública")).toBe("finanzas_contabilidad");
    expect(role("Senior Accountant")).toBe("finanzas_contabilidad");
    expect(role("Bookkeeper freelance")).toBe("finanzas_contabilidad");
    expect(role("FP&A Analyst")).toBe("finanzas_contabilidad");
    expect(role("Analista Financiera")).toBe("finanzas_contabilidad");
    expect(role("Financial Analyst")).toBe("finanzas_contabilidad");
    expect(role("Asistente Virtual")).toBe("asistencia_operaciones");
    expect(role("Executive Assistant")).toBe("asistencia_operaciones");
    expect(role("Asistente administrativa")).toBe("asistencia_operaciones");
    expect(role("Operations Coordinator")).toBe("asistencia_operaciones");
    expect(role("Data entry")).toBe("asistencia_operaciones");
    // negativos: «operations» suelto no alcanza
    expect(role("Operations Manager")).toBeNull();
    expect(role("Sales Operations")).toBeNull();
  });
  it("los titulares de siempre no caen en un puesto nuevo", () => {
    expect(role("Product designer UI")).toBe("ux_ui");
    expect(role("Product designer")).toBeNull();
    expect(role("Desarrollador Backend")).toBe("backend");
    expect(role("Senior Software Engineer")).toBeNull();
    expect(role("Frontend developer en un equipo de producto")).toBe("frontend");
  });
  it("las disciplinas de seguridad y proyectos dan el puesto nuevo, sin pisar a las de siempre", () => {
    expect(role(null, ["ciberseguridad"])).toBe("ciberseguridad");
    expect(role(null, ["project_management"])).toBe("project_manager");
    expect(role(null, ["producto"])).toBe("product_manager");
    expect(role(null, ["ciberseguridad", "backend"])).toBe("backend");
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
  it("rechaza más entradas que el tope", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < MAX_SKILL_ENTRIES + 1; i++) raw[`level:skill_${i}`] = "1";
    expect(parseSkillLevelsForm(raw)).toEqual({ ok: false, field: "niveles" });
    delete raw[`level:skill_${MAX_SKILL_ENTRIES}`];
    expect(parseSkillLevelsForm(raw).ok).toBe(true);
  });
  it("el tope alcanza para toda la taxonomía (antes eran 60 y había más skills)", () => {
    expect(taxonomy.length).toBeGreaterThan(93);
    expect(MAX_SKILL_ENTRIES).toBeGreaterThanOrEqual(taxonomy.length);
    const raw: Record<string, string> = {};
    for (const t of taxonomy) raw[`level:${t.slug}`] = "2";
    const parsed = parseSkillLevelsForm(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entries).toHaveLength(taxonomy.length);
  });
});

describe("parseRemoveSlugs", () => {
  it("deja los slugs válidos sin repetir", () => {
    expect(parseRemoveSlugs(["sql", "sql", "Bad Slug", "react"])).toEqual(["sql", "react"]);
  });
});

describe("waitlistRoleGroups: el selector de /acceso (C6-1)", () => {
  const flat = (g: ReturnType<typeof waitlistRoleGroups>) => g.flatMap((x) => [...x.roles]);

  it("las 6 carreras de la beta, en el orden del anuncio: 4 nuevas + contaduría y marketing", () => {
    expect(BETA_LAUNCH_ROLE_KEYS).toEqual([
      "abogacia",
      "finanzas_contabilidad",
      "administracion_empresas",
      "comunicacion",
      "marketing_digital",
      "relaciones_internacionales",
    ]);
    for (const key of BETA_ROLE_KEYS) expect(BETA_LAUNCH_ROLE_KEYS).toContain(key);
  });

  it("el primer grupo es «Carreras de la beta» y trae las 6", () => {
    const first = waitlistRoleGroups()[0];
    expect(first?.label).toBe("Carreras de la beta");
    expect(first?.roles).toEqual(BETA_LAUNCH_ROLE_KEYS);
  });

  it("después va el resto sin repetir ninguna carrera de la beta", () => {
    const rest = waitlistRoleGroups().slice(1);
    expect(rest.length).toBeGreaterThan(0);
    for (const g of rest) {
      for (const key of BETA_LAUNCH_ROLE_KEYS) expect(g.roles).not.toContain(key);
    }
    expect(rest.map((g) => g.label)).toContain("Tecnología");
  });

  it("cada carrera aparece una sola vez, no hay grupos vacíos y asistencia_operaciones sigue oculta", () => {
    const all = flat(waitlistRoleGroups());
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("asistencia_operaciones");
    for (const g of waitlistRoleGroups()) expect(g.roles.length).toBeGreaterThan(0);
  });

  it("ofrece lo mismo que antes (selector general + beta), solo reordenado", () => {
    const before = flat(selectableRoleGroups(BETA_ROLE_KEYS)).sort();
    expect(flat(waitlistRoleGroups()).sort()).toEqual(before);
  });
});
