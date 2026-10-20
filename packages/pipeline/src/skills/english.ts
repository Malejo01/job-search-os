import { CEFR_LEVELS } from "../onboarding";

/**
 * Inglés en el paso de skills (ronda 78). La persona elige su nivel CEFR (A1 a C2) y de ahí se
 * derivan los niveles de las dos skills de inglés de la taxonomía, que dejan de mostrarse como filas
 * para no tener dos escalas en la misma pantalla. Puro.
 */
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export const ENGLISH_SKILL_SLUGS = ["english_intermediate", "english_fluent"] as const;

const LEVELS_BY_CEFR: Record<CefrLevel, { english_intermediate: number; english_fluent: number }> =
  {
    A1: { english_intermediate: 1, english_fluent: 0 },
    A2: { english_intermediate: 1, english_fluent: 0 },
    B1: { english_intermediate: 2, english_fluent: 0 },
    B2: { english_intermediate: 3, english_fluent: 1 },
    C1: { english_intermediate: 3, english_fluent: 2 },
    C2: { english_intermediate: 3, english_fluent: 3 },
  };

/** Niveles (0 a 3) de `english_intermediate` y `english_fluent` para un nivel CEFR. */
export function skillLevelsFromCefr(cefr: CefrLevel): {
  english_intermediate: number;
  english_fluent: number;
} {
  return { ...LEVELS_BY_CEFR[cefr] };
}

export function isEnglishSkillSlug(slug: string): boolean {
  return (ENGLISH_SKILL_SLUGS as readonly string[]).includes(slug);
}

/**
 * Campo `englishCefr` del formulario de skills. Vacío o ausente: no se toca el inglés (la persona
 * saltea o el perfil todavía no tiene dato). Un valor fuera de A1..C2 es un error del campo.
 */
export function parseEnglishCefr(
  value: string | undefined | null,
): { ok: true; cefr: CefrLevel | null } | { ok: false } {
  const v = (value ?? "").trim();
  if (v === "") return { ok: true, cefr: null };
  const found = CEFR_LEVELS.find((l) => l === v);
  return found ? { ok: true, cefr: found } : { ok: false };
}
