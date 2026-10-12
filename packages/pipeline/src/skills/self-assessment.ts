import { z } from "zod";

/**
 * Skills autodeclaradas (ronda 28): roles objetivo, skills sugeridas por rol, niveles en palabras y
 * validación del formulario. Puro: la app lee el perfil y los criterios y pasa los datos.
 */

/** Los 4 niveles que la persona elige, con el texto exacto que ve. */
export const SELF_LEVELS = [
  { level: 0, label: "nunca lo usé" },
  { level: 1, label: "hice un tutorial o curso" },
  { level: 2, label: "lo usé en un proyecto" },
  { level: 3, label: "lo uso con soltura" },
] as const;

export const ROLE_KEYS = [
  "frontend",
  "backend",
  "fullstack",
  "qa",
  "data_analyst",
  "soporte_it",
  "ai_engineer",
  "ux_ui",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export function isRoleKey(v: unknown): v is RoleKey {
  return typeof v === "string" && (ROLE_KEYS as readonly string[]).includes(v);
}

export const MIN_ROLE_SKILLS = 8;
export const MAX_ROLE_SKILLS = 12;
/** Tope de filas del formulario: la taxonomía tiene 60 skills. */
export const MAX_SKILL_ENTRIES = 60;

const SKILL_SLUG = /^[a-z][a-z0-9_]{0,39}$/;

const roleEntrySchema = z.object({
  label: z.string().min(1).max(40),
  skills: z
    .array(z.string().regex(SKILL_SLUG))
    .min(MIN_ROLE_SKILLS)
    .max(MAX_ROLE_SKILLS)
    .refine((list) => new Set(list).size === list.length, "slugs repetidos"),
});

/** Forma del seed `packages/db/seeds/role_skills.json`. */
export const roleSkillsSchema = z.object(
  Object.fromEntries(ROLE_KEYS.map((k) => [k, roleEntrySchema])) as Record<
    RoleKey,
    typeof roleEntrySchema
  >,
);
export type RoleSkillsMap = z.infer<typeof roleSkillsSchema>;

/** Los slugs sugeridos para el rol, en el orden del seed. */
export function suggestedSkills(role: RoleKey, map: RoleSkillsMap): string[] {
  return [...map[role].skills];
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Palabras clave por rol, ya sin mayúsculas ni acentos. `ia`, `qa`, `ux` y `ui` van como palabra entera. */
const HEADLINE_KEYWORDS: Record<RoleKey, RegExp> = {
  frontend: /front[\s-]?end/,
  backend: /back[\s-]?end/,
  fullstack: /full[\s-]?stack/,
  qa: /\bqa\b|\btester\b|\btesters\b/,
  data_analyst: /data analyst|analista de datos/,
  soporte_it: /soporte/,
  ai_engineer: /ai engineer|\bia\b/,
  ux_ui: /\bux\b|\bui\b/,
};

/** disciplina de los criterios → rol (en orden de prioridad). */
const DISCIPLINE_ROLES: [string, RoleKey][] = [
  ["ai_engineer", "ai_engineer"],
  ["fullstack", "fullstack"],
  ["frontend", "frontend"],
  ["backend", "backend"],
  ["data", "data_analyst"],
];

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/**
 * Rol sugerido por defecto. Primero el titular (gana la palabra clave que aparece antes); si no,
 * las disciplinas permitidas, salvo que sean las de fábrica: esas no dicen nada de la persona.
 */
export function defaultRole(input: {
  headline: string | null | undefined;
  allowedDisciplines: readonly string[] | null | undefined;
  defaultDisciplines: readonly string[];
}): RoleKey | null {
  const headline = normalize(input.headline ?? "");
  let best: { role: RoleKey; index: number } | null = null;
  for (const role of ROLE_KEYS) {
    const m = HEADLINE_KEYWORDS[role].exec(headline);
    if (m && (best === null || m.index < best.index)) best = { role, index: m.index };
  }
  if (best) return best.role;

  const allowed = input.allowedDisciplines ?? [];
  if (allowed.length === 0 || sameSet(allowed, input.defaultDisciplines)) return null;
  for (const [discipline, role] of DISCIPLINE_ROLES) {
    if (allowed.includes(discipline)) return role;
  }
  return null;
}

export type SkillLevelEntry = { slug: string; level: number };
export type SkillLevelsParse =
  { ok: true; entries: SkillLevelEntry[] } | { ok: false; field: string };

/** Slugs de los botones "Quitar" (campo `quitar`): sin repetidos, solo los de formato válido, hasta el tope. */
export function parseRemoveSlugs(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const v of values) if (SKILL_SLUG.test(v)) out.add(v);
  return [...out].slice(0, MAX_SKILL_ENTRIES);
}

const levelValueSchema = z.enum(["0", "1", "2", "3"]);

/**
 * Valida el formulario de niveles: pares `level:<slug>` = "0".."3" o "" (sin responder, no se
 * guarda). Los slugs fuera de la taxonomía los filtra la capa web. Si falla devuelve el campo
 * (`slug`, `level:<slug>` o `niveles`), nunca el valor.
 */
export function parseSkillLevelsForm(raw: Record<string, string | undefined>): SkillLevelsParse {
  const pairs = Object.entries(raw).filter(([k]) => k.startsWith("level:"));
  if (pairs.length > MAX_SKILL_ENTRIES) return { ok: false, field: "niveles" };
  const entries: SkillLevelEntry[] = [];
  const seen = new Set<string>();
  for (const [key, value] of pairs) {
    const slug = key.slice("level:".length);
    if (!SKILL_SLUG.test(slug)) return { ok: false, field: "slug" };
    const v = (value ?? "").trim();
    if (v === "") continue;
    const level = levelValueSchema.safeParse(v);
    if (!level.success) return { ok: false, field: key };
    if (seen.has(slug)) continue;
    seen.add(slug);
    entries.push({ slug, level: Number(level.data) });
  }
  return { ok: true, entries };
}
