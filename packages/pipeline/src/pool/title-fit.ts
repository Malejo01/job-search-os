import { inferSeniorityFromTitle } from "../normalize/seniority";
import {
  AI_PATTERN_EXCLUDED_WORDS,
  TITLE_TERMS,
  hasTerm,
  matchesAiWithTechRole,
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
  ],
};

/** Otra disciplina nombrada en el título: veta el puesto solo si no hay ninguna frase del puesto. */
const VETO_TERMS: Partial<Record<RoleKey, readonly string[]>> = {
  data_analyst: [
    "data engineer",
    "data scientist",
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
  ai_engineer: AI_PATTERN_EXCLUDED_WORDS,
};

const strongTerms = (role: RoleKey): readonly string[] => [
  ...TITLE_TERMS[role],
  ...(EXTRA_STRONG_TERMS[role] ?? []),
];

export function titleFit(title: string, role: RoleKey): TitleFit {
  const padded = normalizeTitleText(title);
  const named =
    strongTerms(role).some((t) => hasTerm(padded, t)) ||
    (role === "ai_engineer" && matchesAiWithTechRole(padded));
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
