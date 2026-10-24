import { inferSeniorityFromTitle } from "../normalize/seniority";
import {
  AI_PATTERN_EXCLUDED_WORDS,
  TITLE_TERMS,
  hasTerm,
  matchesAiWithTechRole,
  matchesRoleTitle,
  normalizeTitleText,
} from "../skills/role-hints";
import type { RoleKey } from "../skills/self-assessment";

/**
 * Ajuste del título al puesto y nivel del título (ronda 51). Puro: solo mira el título que ya
 * está en el pool. No cambia `role_hints`; ordena y descarta al armar la selección de una persona.
 */

/** 2 = el título nombra el cargo; 1 = el puesto vino de la categoría y nada lo contradice; 0 = vetado. */
export type TitleFit = 0 | 1 | 2;

/** Frases fuertes que se suman a `TITLE_TERMS` (ya sin acentos ni signos). */
const EXTRA_STRONG_TERMS: Partial<Record<RoleKey, readonly string[]>> = {
  data_analyst: [
    "bi analyst",
    "reporting analyst",
    "insights analyst",
    "analytics analyst",
    "analista de bi",
    // Análisis de fraude es análisis con datos. Solo pesa si el aviso ya trae el hint data_analyst
    // ("fraud data analyst" ya entra por "data analyst").
    "fraud analyst",
    "fraud operations analyst",
  ],
};

const PRODUCT_ROLES: readonly RoleKey[] = [
  "product_manager",
  "product_owner",
  "project_manager",
  "product_marketing",
];

/** Títulos de desarrollo y diseño: ninguna carrera de producto los quiere. */
const PRODUCT_VETO_EXTRA = ["engineer", "developer", "desarrollador", "desarrolladora", "designer"];

/**
 * Frases de las otras tres carreras de producto, más desarrollo y diseño. `project_manager` suma
 * además los títulos de asistencia y operaciones (C-2b, D9): comparten la categoría de operaciones.
 */
function productVeto(role: RoleKey): readonly string[] {
  return [
    ...PRODUCT_ROLES.filter((r) => r !== role).flatMap((r) => TITLE_TERMS[r]),
    ...PRODUCT_VETO_EXTRA,
    ...(role === "project_manager" ? TITLE_TERMS.asistencia_operaciones : []),
  ];
}

/** Otra disciplina nombrada en el título: veta el puesto solo si no hay ninguna frase del puesto. */
const VETO_TERMS: Partial<Record<RoleKey, readonly string[]>> = {
  data_analyst: [
    "data engineer",
    // Ronda 106: la carrera data_engineer toma estos títulos.
    "analytics engineer",
    "etl",
    "data platform engineer",
    "big data engineer",
    "ingeniero de datos",
    "ingeniera de datos",
    "machine learning",
    "ml engineer",
    "ai engineer",
    "research scientist",
    "applied scientist",
    "mlops",
    "software engineer",
    "backend",
    "back end",
    "frontend",
    "front end",
    "full stack",
    "fullstack",
    "devops",
    "sre",
    "platform engineer",
  ],
  // Ronda 106: data_analyst y data_engineer comparten la categoría de datos; cada una veta a la otra.
  data_engineer: [
    "data analyst",
    "analista de datos",
    "data scientist",
    "business intelligence",
    "machine learning",
    "ml engineer",
    "ai engineer",
    "research scientist",
    "applied scientist",
    "mlops",
    "frontend",
    "front end",
    "full stack",
    "fullstack",
  ],
  ai_engineer: AI_PATTERN_EXCLUDED_WORDS,
  // Ronda 107 (ADR-022). Ventas, atención, customer success y soporte comparten categorías de la
  // fuente: cada carrera veta los títulos de las vecinas. Un título con frase propia nunca se veta.
  ventas_b2b: [
    ...TITLE_TERMS.solutions_engineer,
    ...TITLE_TERMS.customer_success,
    ...TITLE_TERMS.atencion_cliente,
    "engineer",
    "developer",
  ],
  solutions_engineer: TITLE_TERMS.ventas_b2b,
  atencion_cliente: [
    ...TITLE_TERMS.customer_success,
    ...TITLE_TERMS.soporte_it,
    "engineer",
    "developer",
    "success",
  ],
  customer_success: [...TITLE_TERMS.ventas_b2b, ...TITLE_TERMS.atencion_cliente],
  // C-2b (ADR-023): cada carrera veta a las vecinas que comparten categoría. Un título con frase
  // propia nunca se veta.
  finanzas_contabilidad: [...TITLE_TERMS.data_engineer, "engineer", "developer", "software"],
  asistencia_operaciones: [
    ...TITLE_TERMS.project_manager,
    ...TITLE_TERMS.soporte_it,
    ...TITLE_TERMS.finanzas_contabilidad,
    "engineer",
    "developer",
  ],
  // Nunca "customer support": «Customer Support Engineer» con categoría de soporte técnico sigue
  // siendo soporte_it.
  soporte_it: [
    "call center",
    "contact center",
    "contact centre",
    "atencion al cliente",
    "servicio al cliente",
    "customer service",
    "customer care",
  ],
  // Las categorías de producto juntan las cuatro carreras (ronda 97): cada una veta los títulos de
  // las otras tres y los de desarrollo y diseño. Un título con frase propia nunca se veta.
  product_manager: productVeto("product_manager"),
  product_owner: productVeto("product_owner"),
  project_manager: productVeto("project_manager"),
  product_marketing: productVeto("product_marketing"),
};

const strongTerms = (role: RoleKey): readonly string[] => [
  ...TITLE_TERMS[role],
  ...(EXTRA_STRONG_TERMS[role] ?? []),
  // Solo para ordenar la consulta (aproximada): la exclusión de manufactura la aplica matchesRoleTitle.
  ...(role === "fullstack" ? ["product engineer"] : []),
];

/** Rol técnico en español para el patrón "AI + rol" ("Desarrollador Full-Stack AI"). */
const AI_TECH_ROLE_WORDS_ES = [
  "desarrollador",
  "desarrolladora",
  "ingeniero",
  "ingeniera",
  "arquitecto",
  "arquitecta",
];

/** El mismo patrón de `matchesAiWithTechRole`, con el rol técnico en español. */
function matchesAiWithTechRoleEs(padded: string): boolean {
  return (
    (hasTerm(padded, "ai") || hasTerm(padded, "ml")) &&
    AI_TECH_ROLE_WORDS_ES.some((w) => hasTerm(padded, w)) &&
    !AI_PATTERN_EXCLUDED_WORDS.some((w) => hasTerm(padded, w))
  );
}

/** Palabras de rol técnico en inglés (las mismas de `matchesAiWithTechRole`, que no las exporta). */
const AI_TECH_ROLE_WORDS_EN = ["engineer", "developer", "architect", "scientist", "researcher"];

/**
 * Palabras previas al rol que indican que el núcleo del puesto es otra disciplina: una migración
 * de datos con "AI" al final del título es migración, no ingeniería de IA. Lista
 * corta y conservadora (sin acentos). No incluye "software", "backend" ni "platform": con esos el
 * "AI" final sí suele nombrar el puesto ("Software Engineer, AI"). "data" está porque
 * "Data Engineer AI" es ingeniería de datos; "AI Data Engineer" (AI antes) sigue contando.
 */
const OTHER_DISCIPLINE_CORE = [
  "migration",
  "databricks",
  "sas",
  "etl",
  "database",
  "data",
  "sql",
  "salesforce",
  "sap",
  "network",
  "qa",
  "test",
  "devops",
  "cloud",
  "security",
  "hardware",
  "mechanical",
  "electrical",
  "civil",
];

/**
 * `matchesAiWithTechRole` con orden: si "ai"/"ml" está antes de la palabra de rol técnico nombra
 * el puesto; si solo está después, nombra el puesto únicamente cuando las palabras previas al rol
 * no son de otra disciplina. Solo refina el patrón en inglés; el español no cambia.
 */
function namesAiEngineerInEnglish(padded: string): boolean {
  if (!matchesAiWithTechRole(padded)) return false;
  const words = padded.trim().split(" ");
  const isAi = (w: string) => w === "ai" || w === "ml";
  const roleIdx = words.findIndex((w) =>
    AI_TECH_ROLE_WORDS_EN.some((r) => w === r || w === `${r}s`),
  );
  if (roleIdx < 0) return true;
  // "Data Scientist, ML": scientist/researcher con "data" delante sigue nombrando el puesto.
  if (/^(scientist|researcher)s?$/.test(words[roleIdx]!)) return true;
  if (words.slice(0, roleIdx).some(isAi)) return true;
  return !words.slice(0, roleIdx).some((w) => OTHER_DISCIPLINE_CORE.includes(w));
}

export function titleFit(title: string, role: RoleKey): TitleFit {
  const padded = normalizeTitleText(title);
  const named =
    matchesRoleTitle(padded, role, EXTRA_STRONG_TERMS[role]) ||
    (role === "ai_engineer" &&
      (namesAiEngineerInEnglish(padded) || matchesAiWithTechRoleEs(padded)));
  if (named) return 2;
  if ((VETO_TERMS[role] ?? []).some((t) => hasTerm(padded, t))) return 0;
  return 1;
}

/**
 * Expresión regular POSIX (para `~*` de Postgres) con las frases fuertes de los puestos, para
 * ordenar la consulta de candidatas antes del tope. Aproximada: no pliega acentos. Sin puestos, null.
 */
export function strongTitlePattern(roles: readonly RoleKey[]): string | null {
  const terms = [...new Set(roles.flatMap((r) => strongTerms(r)))];
  if (!terms.length) return null;
  return `\\m(${terms.map((t) => t.replace(/ /g, "[^[:alnum:]]+")).join("|")})s?\\M`;
}

export type TitleLevel = "staff_plus" | "senior";

const STAFF_PLUS_WORDS = ["staff", "principal", "head", "director", "directora", "vp", "chief"];
const STAFF_PLUS_PHRASES = ["vice president"];
const GROUP_LEAD = /\bgroup (?:(?:product|engineering) )?(?:manager|lead)\b/;

/**
 * Nivel que declara el título. `staff_plus` va por palabra (sin pedir rol técnico, así entra
 * "Principal Data Analyst"); `group` solo en "group manager/lead". `senior` es Senior o Lead
 * puros: un rango ("Mid/Senior") no cuenta.
 */
export function titleLevel(title: string): TitleLevel | null {
  const padded = normalizeTitleText(title);
  if (
    STAFF_PLUS_WORDS.some((w) => padded.includes(` ${w} `)) ||
    STAFF_PLUS_PHRASES.some((p) => padded.includes(` ${p} `)) ||
    GROUP_LEAD.test(padded)
  ) {
    return "staff_plus";
  }
  const seniority = inferSeniorityFromTitle(title);
  return seniority === "Senior" || seniority === "Lead" ? "senior" : null;
}

/** Con menos años que esto, el nivel del título pesa. */
export const SENIOR_YEARS_THRESHOLD = 5;

/** Nivel de título pesa solo con años conocidos y menores a `SENIOR_YEARS_THRESHOLD`. */
const isJunior = (yearsTotal: number | null | undefined): boolean =>
  yearsTotal !== null && yearsTotal !== undefined && yearsTotal < SENIOR_YEARS_THRESHOLD;

/** Staff/Principal/Head... para una persona con menos de 5 años: no se asigna. */
export function isTooSenior(title: string, yearsTotal: number | null | undefined): boolean {
  return isJunior(yearsTotal) && titleLevel(title) === "staff_plus";
}

export type PoolTitleAssessment = {
  /** Máximo entre los puestos de la persona que están en los hints; 0 si no hay ninguno. */
  titleFit: TitleFit;
  /** Hints sin los puestos de la persona que el título veta (lo que agrupa `interleaveByRole`). */
  effectiveHints: string[];
  level: TitleLevel | null;
  /** 1 si el título es Senior/Lead y la persona tiene menos de 5 años; si no, 0. */
  seniorPenalty: 0 | 1;
  /** Staff/Principal/Head... para una persona con menos de 5 años: no se asigna. */
  tooSenior: boolean;
};

export function assessPoolTitle(input: {
  title: string;
  roleHints: readonly string[];
  roles: readonly RoleKey[];
  yearsTotal: number | null;
}): PoolTitleAssessment {
  const fits = input.roles
    .filter((r) => input.roleHints.includes(r))
    .map((r) => [r, titleFit(input.title, r)] as const);
  const vetoed = new Set(fits.filter(([, f]) => f === 0).map(([r]) => r as string));
  const level = titleLevel(input.title);
  return {
    titleFit: fits.reduce<TitleFit>((m, [, f]) => (f > m ? f : m), 0),
    effectiveHints: input.roleHints.filter((h) => !vetoed.has(h)),
    level,
    seniorPenalty: isJunior(input.yearsTotal) && level === "senior" ? 1 : 0,
    tooSenior: isTooSenior(input.title, input.yearsTotal),
  };
}
