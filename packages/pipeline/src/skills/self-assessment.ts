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
  "marketing_digital",
  "rrhh_it",
  "customer_success",
  "ciberseguridad",
  "product_manager",
  "product_owner",
  "project_manager",
  "product_marketing",
  // Ronda 106 (ADR-021): carreras de tecnología nuevas, siempre al final.
  "data_engineer",
  "solutions_engineer",
  // Ronda 107 (ADR-022): ventas y atención, siempre al final.
  "ventas_b2b",
  "atencion_cliente",
  // C-2b (ADR-023): finanzas y asistencia/operaciones, siempre al final.
  "finanzas_contabilidad",
  "asistencia_operaciones",
  // C1-2 (ADR-027): carreras de la beta, siempre al final.
  "abogacia",
  "administracion_empresas",
  "comunicacion",
  "relaciones_internacionales",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/**
 * Los puestos de tecnología de antes de la ronda 40. Son los que valen cuando la persona no eligió
 * puesto (`select.ts`, `explain.ts`): las carreras de la ronda 106 no se suman a ese default.
 */
export const IT_ROLE_KEYS: readonly RoleKey[] = [
  "frontend",
  "backend",
  "fullstack",
  "qa",
  "data_analyst",
  "soporte_it",
  "ai_engineer",
  "ux_ui",
];

/** Las carreras de tecnología que se abrieron en la ronda 106 (ADR-021). */
const NEW_TECH_ROLE_KEYS: readonly RoleKey[] = ["data_engineer", "solutions_engineer"];

/** Los puestos de carreras digitales que no son de producto (ronda 40). */
const OTHER_DIGITAL_ROLE_KEYS: readonly RoleKey[] = [
  "marketing_digital",
  "rrhh_it",
  "customer_success",
  "ciberseguridad",
];

/** Los puestos de producto y proyectos (ronda 97, ADR-019). */
export const PRODUCT_ROLE_KEYS: readonly RoleKey[] = [
  "product_manager",
  "product_owner",
  "project_manager",
  "product_marketing",
];

/** Las carreras comerciales y de atención (ronda 107, ADR-022). */
export const COMMERCIAL_ROLE_KEYS: readonly RoleKey[] = ["ventas_b2b", "atencion_cliente"];

/** Las carreras de finanzas y de asistencia/operaciones (C-2b, ADR-023). */
export const BACKOFFICE_ROLE_KEYS: readonly RoleKey[] = [
  "finanzas_contabilidad",
  "asistencia_operaciones",
];

/** Las carreras de derecho y de gestión de la beta (ADR-027). */
export const LEGAL_MANAGEMENT_ROLE_KEYS: readonly RoleKey[] = [
  "abogacia",
  "administracion_empresas",
];

/** Las carreras de comunicación y de relaciones internacionales de la beta (ADR-027). */
export const COMMUNICATION_ROLE_KEYS: readonly RoleKey[] = [
  "comunicacion",
  "relaciones_internacionales",
];

/**
 * Todo lo que no es IT: carreras digitales, de producto, ventas, atención, finanzas, operaciones,
 * derecho, gestión y comunicación.
 */
export const DIGITAL_ROLE_KEYS: readonly RoleKey[] = [
  ...OTHER_DIGITAL_ROLE_KEYS,
  ...PRODUCT_ROLE_KEYS,
  ...COMMERCIAL_ROLE_KEYS,
  ...BACKOFFICE_ROLE_KEYS,
  ...LEGAL_MANAGEMENT_ROLE_KEYS,
  ...COMMUNICATION_ROLE_KEYS,
];

/** Grupos del selector de puesto: juntos cubren `ROLE_KEYS` sin repetir. */
export const ROLE_GROUPS: readonly { label: string; roles: readonly RoleKey[] }[] = [
  { label: "Tecnología", roles: [...IT_ROLE_KEYS, ...NEW_TECH_ROLE_KEYS] },
  { label: "Producto y proyectos", roles: PRODUCT_ROLE_KEYS },
  { label: "Carreras digitales", roles: OTHER_DIGITAL_ROLE_KEYS },
  { label: "Ventas y atención", roles: COMMERCIAL_ROLE_KEYS },
  { label: "Finanzas y operaciones", roles: BACKOFFICE_ROLE_KEYS },
  { label: "Derecho, contabilidad y gestión", roles: LEGAL_MANAGEMENT_ROLE_KEYS },
  { label: "Comunicación y relaciones", roles: COMMUNICATION_ROLE_KEYS },
];

/**
 * Carreras que existen pero todavía no se ofrecen en los selectores (menos de 10 ofertas, ADR-022).
 * Quien ya la tiene la conserva: `isRoleKey`, la ingesta y `/mercado/<clave>` no cambian. Las cuatro
 * de la beta (ADR-027) salen así hasta medir su volumen después de `pool:rehint`.
 */
export const UNLISTED_ROLE_KEYS: readonly RoleKey[] = [
  "asistencia_operaciones",
  "abogacia",
  "administracion_empresas",
  "comunicacion",
  "relaciones_internacionales",
];

/**
 * `ROLE_GROUPS` sin las carreras no listadas, salvo las de `keep` (las del perfil de la persona), y
 * sin grupos vacíos.
 */
export function selectableRoleGroups(
  keep: readonly RoleKey[] = [],
): readonly { label: string; roles: readonly RoleKey[] }[] {
  return ROLE_GROUPS.map((g) => ({
    label: g.label,
    roles: g.roles.filter((r) => !UNLISTED_ROLE_KEYS.includes(r) || keep.includes(r)),
  })).filter((g) => g.roles.length > 0);
}

export function isRoleKey(v: unknown): v is RoleKey {
  return typeof v === "string" && (ROLE_KEYS as readonly string[]).includes(v);
}

/**
 * Clave que ya no se elige → la que la reemplaza. `producto_proyectos` se partió en cuatro carreras
 * (ronda 97): la traducción deja que el código nuevo lea perfiles anteriores a la migración de datos.
 * Se borra cuando no queden filas con la clave vieja.
 */
export const LEGACY_ROLE_KEYS: Readonly<Record<string, RoleKey>> = {
  producto_proyectos: "product_manager",
};

/** La clave como `RoleKey`: traduce las anteriores y valida; si no es ninguna, null. */
export function toRoleKey(v: unknown): RoleKey | null {
  if (typeof v !== "string") return null;
  if (isRoleKey(v)) return v;
  return Object.hasOwn(LEGACY_ROLE_KEYS, v) ? LEGACY_ROLE_KEYS[v]! : null;
}

export const MIN_ROLE_SKILLS = 8;
export const MAX_ROLE_SKILLS = 12;
/**
 * Tope de filas `level:<slug>` del formulario. Limita lo que se acepta de un envío, no lo que se
 * muestra: tiene que alcanzar para toda la taxonomía (unas 100 skills, `taxonomy.test.ts` lo vigila)
 * con holgura para que crezca.
 */
export const MAX_SKILL_ENTRIES = 200;

export const SKILL_SLUG = /^[a-z][a-z0-9_]{0,39}$/;

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
  marketing_digital:
    /marketing digital|digital marketing|\bseo\b|performance marketing|community manager|relaciones publicas|public relations|\brrpp\b|brand manager/,
  product_manager: /product manager|(?:gerente|jefe|jefa) de producto/,
  product_owner: /product owner|due[nñ][oa] de producto/,
  project_manager:
    /project manager|program manager|scrum master|agile coach|\bpmo\b|(?:gerente|jefe|jefa|lider|coordinador|coordinadora) de proyectos/,
  product_marketing: /product marketing|marketing de producto/,
  data_engineer: /data engineer|analytics engineer|ingenier[oa] de datos/,
  solutions_engineer:
    /solutions? engineer|solutions? architect|sales engineer|\bpre-?sales\b|preventa|forward deployed/,
  rrhh_it:
    /\brecruiters?\b|\breclutador(?:a|es|as)?\b|talent acquisition|\brrhh\b|recursos humanos/,
  customer_success: /customer success/,
  ventas_b2b:
    /\bsdr\b|\bbdr\b|account executive|business development|inside sales|sales (?:development|representative|executive)|ejecutiv[oa] (?:comercial|de ventas|de cuentas)/,
  atencion_cliente:
    /customer (?:support|service|care)|atencion al cliente|servicio al cliente|call center/,
  ciberseguridad: /ciberseguridad|cybersecurity|seguridad informatica|\binfosec\b/,
  finanzas_contabilidad:
    /\bcontador(?:a)?\b|contab|accountant|bookkeep|fp&a|financial analyst|analista financier[oa]|\bfinanzas\b/,
  asistencia_operaciones:
    /asistente (?:virtual|ejecutiv[oa]|administrativ[oa])|(?:virtual|executive|administrative) assistant|operations (?:coordinator|specialist|associate)|data entry/,
  abogacia: /\babogad[oa]s?\b|\blawyer\b|\battorney\b|\bparalegal\b|legal counsel|asesor[a]? legal/,
  administracion_empresas:
    /administracion de empresas|business administration|licenciad[oa] en administracion/,
  comunicacion:
    /\bperiodista\b|\bjournalist\b|\bcomunicador(?:a)? social|comunicacion (?:institucional|interna|social)|licenciad[oa] en comunicacion|(?:jefe|jefa|responsable) de prensa|communications? (?:specialist|manager|officer)/,
  relaciones_internacionales:
    /relaciones internacionales|international relations|comercio exterior|foreign trade|cooperacion internacional|\bcomex\b/,
};

/** disciplina de los criterios → rol (en orden de prioridad). */
const DISCIPLINE_ROLES: [string, RoleKey][] = [
  ["ai_engineer", "ai_engineer"],
  ["fullstack", "fullstack"],
  ["frontend", "frontend"],
  ["backend", "backend"],
  ["data", "data_analyst"],
  // Al final: los de arriba no cambian de prioridad
  ["ciberseguridad", "ciberseguridad"],
  ["project_management", "project_manager"],
  ["marketing_digital", "marketing_digital"],
  ["producto", "product_manager"],
  ["recursos_humanos", "rrhh_it"],
  ["customer_success", "customer_success"],
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
