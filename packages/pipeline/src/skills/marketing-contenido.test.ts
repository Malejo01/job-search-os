import { describe, expect, it } from "vitest";
import roleSkillsSeed from "../../../db/seeds/role_skills.json";
import skills from "../../../db/seeds/skills.json";
import { ALERT_KEYWORDS, alertKeywordsFor } from "../alerts/portal-guide";
import { compileTaxonomy, extractSkillsFromText } from "./match";
import { filterPlanByCareer } from "./plan";
import { inferRoleHints, matchesRoleTitle, normalizeTitleText } from "./role-hints";
import {
  CONTENT_ROLE_KEYS,
  MAX_ROLE_SKILLS,
  MIN_ROLE_SKILLS,
  ROLE_KEYS,
  UNLISTED_ROLE_KEYS,
  isRoleKey,
  profileRoleGroups,
  roleSkillsSchema,
  selectableRoleGroups,
  waitlistRoleGroups,
  type RoleKey,
} from "./self-assessment";

/**
 * Puestos de marketing y contenido (R14-1): marketing con IA, edición de video y creación de contenido.
 * Todo inventado: títulos genéricos, sin avisos reales.
 */
const NEW_ROLES = ["marketing_ia", "edicion_video", "creacion_contenido"] as const;
const NEW_SKILLS = [
  "video_editing_tools",
  "ugc_content",
  "short_video_scripting",
  "generative_ai_content",
  "social_analytics",
];
const roleSkills = roleSkillsSchema.parse(roleSkillsSeed);
const taxonomy = skills as { slug: string; category: string; aliases: string[] }[];
const extract = (text: string) => extractSkillsFromText(text, compileTaxonomy(skills));
const hints = (title: string) => inferRoleHints({ sourceKind: "other", title });
const is = (title: string, role: RoleKey) => matchesRoleTitle(normalizeTitleText(title), role);
const flat = (g: readonly { roles: readonly RoleKey[] }[]) => g.flatMap((x) => [...x.roles]);

describe("claves y rótulos", () => {
  it("son claves válidas, van al final de ROLE_KEYS y ninguna clave anterior cambió", () => {
    for (const r of NEW_ROLES) expect(isRoleKey(r)).toBe(true);
    expect(ROLE_KEYS.slice(-3)).toEqual([...NEW_ROLES]);
    expect([...CONTENT_ROLE_KEYS]).toEqual([...NEW_ROLES]);
    // Las claves que ya existían siguen en su lugar
    expect(ROLE_KEYS.slice(0, 4)).toEqual(["frontend", "backend", "fullstack", "qa"]);
    expect(ROLE_KEYS.at(-4)).toBe("relaciones_publicas");
  });

  it("rótulos y de 8 a 12 skills, todas en la taxonomía", () => {
    expect(roleSkills.marketing_ia.label).toBe("Marketing con IA");
    expect(roleSkills.edicion_video.label).toBe("Edición de video");
    expect(roleSkills.creacion_contenido.label).toBe("Creación de contenido (UGC y redes)");
    const known = new Set(taxonomy.map((s) => s.slug));
    for (const r of NEW_ROLES) {
      const list = roleSkills[r].skills;
      expect(list.length, r).toBeGreaterThanOrEqual(MIN_ROLE_SKILLS);
      expect(list.length, r).toBeLessThanOrEqual(MAX_ROLE_SKILLS);
      for (const slug of list) expect(known.has(slug), `${r}: ${slug}`).toBe(true);
    }
  });

  it("cada skill nueva es de dominio y la usa algún puesto nuevo", () => {
    for (const slug of NEW_SKILLS) {
      const s = taxonomy.find((t) => t.slug === slug);
      expect(s, slug).toBeDefined();
      expect(s!.category).toBe("dominio");
      expect(
        NEW_ROLES.some((r) => roleSkills[r].skills.includes(slug)),
        slug,
      ).toBe(true);
    }
  });
});

describe("skills con evidencia (aliases en español e inglés)", () => {
  it.each([
    ["Edición en Premiere y DaVinci Resolve", "video_editing_tools"],
    ["Edición en After Effects", "video_editing_tools"],
    ["Armado de contenido UGC para marcas", "ugc_content"],
    ["Experience as a UGC creator", "ugc_content"],
    ["Guion para reels y videos cortos", "short_video_scripting"],
    ["Short-form video scripting", "short_video_scripting"],
    ["Armado de contenido con IA para redes", "generative_ai_content"],
    ["Uso de ChatGPT para marketing", "generative_ai_content"],
    ["Experience with Midjourney and Canva Magic", "generative_ai_content"],
    ["Métricas de redes y reportes de engagement", "social_analytics"],
    ["Social media analytics and engagement rate", "social_analytics"],
  ])("«%s» marca %s", (text, slug) => {
    expect(extract(text)).toContain(slug);
  });

  it("las palabras genéricas de IA o de redes no marcan las skills de marketing en avisos de otra familia", () => {
    const programacion = [
      "Experiencia con Generative AI, GenAI y ChatGPT para asistir el desarrollo",
      "Experience with generative AI, LLMs and ChatGPT APIs",
      "Uso de IA generativa y herramientas de IA en el equipo de datos",
      "Consultoría de estrategia de inteligencia artificial generativa",
    ];
    for (const text of programacion) {
      expect(extract(text), text).not.toContain("generative_ai_content");
    }
    const otras = [
      "Seguimiento de reels y videos cortos del área de prensa",
      "Redacción y creación de contenido institucional",
      "Content creation for our developer docs",
      "Motion graphics y corrección de color en piezas de diseño de producto",
    ];
    for (const text of otras) {
      const got = extract(text);
      for (const slug of NEW_SKILLS) expect(got, `${text} → ${slug}`).not.toContain(slug);
    }
  });

  it("Canva y CapCut ya existían y siguen marcando", () => {
    expect(extract("Manejo de Canva y CapCut")).toEqual(
      expect.arrayContaining(["canva", "capcut"]),
    );
  });
});

describe("plan de formación: nada de otra familia", () => {
  const demand = (slug: string, mentions: number) => ({
    slug,
    mentions,
    mustMentions: mentions,
    weightedDemand: mentions * 5,
  });
  const offFamily = [
    demand("general_accounting", 1),
    demand("contract_drafting", 1),
    demand("press_relations", 1),
    demand("docker", 1),
    demand("iam", 1),
    { ...demand("multimodal", 1), category: "ai_core" },
  ];

  it.each(NEW_ROLES)(
    "%s: las propias se quedan y las de otra familia con poca demanda salen",
    (role) => {
      const own = roleSkills[role].skills.map((s) => demand(s, 1));
      const out = filterPlanByCareer([...own, ...offFamily], role, roleSkills).map((r) => r.slug);
      for (const slug of roleSkills[role].skills) expect(out).toContain(slug);
      for (const r of offFamily) expect(out, r.slug).not.toContain(r.slug);
    },
  );

  it("los puestos de contenido no se roban skills entre sí sin demanda (cada uno es su familia)", () => {
    // `video_editing_tools` es de Edición de video: Marketing con IA no la trae con una mención
    const out = filterPlanByCareer(
      [demand("video_editing_tools", 1), demand("generative_ai_content", 1)],
      "marketing_ia",
      roleSkills,
    ).map((r) => r.slug);
    expect(out).toEqual(["generative_ai_content"]);
  });

  it("Contaduría no recibe las skills nuevas", () => {
    const out = filterPlanByCareer(
      [demand("general_accounting", 20), ...NEW_SKILLS.map((s) => demand(s, 1))],
      "finanzas_contabilidad",
      roleSkills,
    ).map((r) => r.slug);
    expect(out).toEqual(["general_accounting"]);
  });
});

describe("palabras de alerta", () => {
  it.each(NEW_ROLES)("%s: de 3 a 6 palabras en español y en inglés", (role) => {
    const entry = ALERT_KEYWORDS[role];
    expect(entry).toBeDefined();
    for (const lang of ["es", "en"] as const) {
      expect(entry![lang].length, `${role}/${lang}`).toBeGreaterThanOrEqual(3);
      expect(entry![lang].length, `${role}/${lang}`).toBeLessThanOrEqual(6);
      expect(new Set(entry![lang]).size).toBe(entry![lang].length);
    }
  });

  it("las sugeridas traen cada idioma y «both» las junta sin repetir", () => {
    expect(alertKeywordsFor(["marketing_ia"], "es")).toContain("marketing con ia");
    expect(alertKeywordsFor(["marketing_ia"], "en")).toContain("ai marketing");
    expect(alertKeywordsFor(["edicion_video"], "es")).toContain("editor de video");
    expect(alertKeywordsFor(["edicion_video"], "en")).toContain("video editor");
    expect(alertKeywordsFor(["creacion_contenido"], "es")).toContain("creador de contenido");
    expect(alertKeywordsFor(["creacion_contenido"], "en")).toContain("ugc creator");
    const both = alertKeywordsFor(["edicion_video"], "both");
    expect(new Set(both).size).toBe(both.length);
    expect(both).toEqual(
      expect.arrayContaining(["editor de video", "video editor", "motion graphics"]),
    );
  });
});

describe("detector de carrera del pool (títulos)", () => {
  it("«Editor/a de video para redes» es Edición de video", () => {
    expect(is("Editor/a de video para redes", "edicion_video")).toBe(true);
    expect(hints("Editor/a de video para redes")).toContain("edicion_video");
  });

  it("«UGC Creator» es Creación de contenido", () => {
    expect(is("UGC Creator", "creacion_contenido")).toBe(true);
    expect(hints("UGC Creator")).toContain("creacion_contenido");
    expect(hints("Creador/a de contenido UGC para marcas")).toContain("creacion_contenido");
  });

  it("«Especialista en marketing con IA» es Marketing con IA", () => {
    expect(is("Especialista en marketing con IA", "marketing_ia")).toBe(true);
    expect(hints("Especialista en marketing con IA")).toContain("marketing_ia");
    expect(hints("AI Marketing Specialist")).toContain("marketing_ia");
  });

  it("también en inglés y con otras formas del cargo", () => {
    expect(hints("Video Editor (short-form)")).toContain("edicion_video");
    expect(hints("Motionista y Montajista")).toContain("edicion_video");
    expect(hints("Content Creator para redes")).toContain("creacion_contenido");
  });

  it("un título de otra carrera no cae en estos puestos", () => {
    for (const title of [
      "Contador/a",
      "Contador/a público con Excel",
      "Abogado/a corporativo",
      "Desarrollador/a de IA",
      "Ingeniero/a de IA",
      "Editor/a de textos",
      "Analista de marketing digital",
      "Asistente administrativo",
    ]) {
      const got = hints(title);
      for (const r of NEW_ROLES) expect(got, `${title} → ${r}`).not.toContain(r);
    }
    expect(hints("Contador/a")).toContain("finanzas_contabilidad");
  });
});

describe("selectores", () => {
  it("son puestos que se eligen en el perfil, no en la lista de espera ni en el selector general", () => {
    for (const r of NEW_ROLES) {
      expect(UNLISTED_ROLE_KEYS).toContain(r);
      expect(flat(selectableRoleGroups())).not.toContain(r);
      expect(flat(profileRoleGroups())).toContain(r);
      // /acceso guarda la clave en la lista de espera, cuyo CHECK no las conoce
      expect(flat(waitlistRoleGroups())).not.toContain(r);
    }
  });
});
