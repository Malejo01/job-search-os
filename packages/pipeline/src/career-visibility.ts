import {
  CAREER_REVEAL_THRESHOLD,
  buildCareerRevealRows,
  type CareerRevealCount,
} from "./career-reveal";
import { BETA_ROLE_KEYS, ROLE_KEYS, type RoleKey } from "./skills/self-assessment";

/**
 * Qué carreras se muestran en las páginas públicas (ADR-029, complemento de ADR-022). Puro: recibe cuántas
 * ofertas tuvo cada carrera y devuelve cuáles se muestran, sin I/O.
 *
 * - Una carrera de la beta (`PUBLIC_THRESHOLD_ROLE_KEYS`) se muestra cuando llega al umbral de ADR-022
 *   (`CAREER_REVEAL_THRESHOLD` ofertas): el mismo conteo y el mismo umbral de la tabla «lista para
 *   mostrarse» de `/settings/metricas` (`buildCareerRevealRows`).
 * - Las demás carreras se muestran siempre, como hasta ahora.
 * - Dos listas de override a mano, en código: siempre oculta y siempre visible. Si una carrera está en
 *   las dos, gana oculta (la opción conservadora).
 * - **Falla cerrado:** sin conteos (`null`: la base no responde o no está configurada) las carreras
 *   sujetas al umbral se ocultan. Las demás no dependen de la base y se siguen mostrando.
 *
 * Solo manda sobre las páginas públicas, el sitemap y los chips: los selectores de onboarding, perfil y
 * `/acceso` siguen ofreciendo siempre `BETA_ROLE_KEYS` (C5-1) y no usan esto.
 */

/** Carreras cuya aparición en público depende del umbral: las de la beta (ADR-027). */
export const PUBLIC_THRESHOLD_ROLE_KEYS: readonly RoleKey[] = BETA_ROLE_KEYS;

export type CareerVisibilityOverrides = {
  /** Nunca se muestran en público, llegue o no al umbral. */
  readonly alwaysHidden: readonly RoleKey[];
  /** Siempre se muestran, aunque no lleguen al umbral ni haya datos. */
  readonly alwaysVisible: readonly RoleKey[];
};

/**
 * Override manual. Para forzar una carrera se agrega su clave acá y se mergea un PR de una línea.
 * `asistencia_operaciones` queda oculta como estaba (ADR-022 §7): para que también entre por el umbral,
 * se la saca de esta lista y se la suma a `PUBLIC_THRESHOLD_ROLE_KEYS`.
 */
export const CAREER_VISIBILITY_OVERRIDES: CareerVisibilityOverrides = {
  alwaysHidden: ["asistencia_operaciones"],
  alwaysVisible: [],
};

/** Carreras que el panel de métricas vigila: las del umbral más las que están forzadas a ocultas. */
export function watchedCareerKeys(
  overrides: CareerVisibilityOverrides = CAREER_VISIBILITY_OVERRIDES,
): readonly RoleKey[] {
  return [...new Set<RoleKey>([...PUBLIC_THRESHOLD_ROLE_KEYS, ...overrides.alwaysHidden])];
}

/**
 * Las carreras que se muestran en público, en el orden de `ROLE_KEYS`. `counts` son las ofertas por carrera
 * (`readCareerRevealCounts`); `null` = sin datos, falla cerrado.
 */
export function publicCareerKeys(
  counts: readonly CareerRevealCount[] | null,
  overrides: CareerVisibilityOverrides = CAREER_VISIBILITY_OVERRIDES,
): readonly RoleKey[] {
  const ready = new Set<string>(
    counts
      ? buildCareerRevealRows(PUBLIC_THRESHOLD_ROLE_KEYS, counts, CAREER_REVEAL_THRESHOLD)
          .filter((row) => row.ready)
          .map((row) => row.role)
      : [],
  );
  return ROLE_KEYS.filter((key) => {
    if (overrides.alwaysHidden.includes(key)) return false;
    if (overrides.alwaysVisible.includes(key)) return true;
    if (PUBLIC_THRESHOLD_ROLE_KEYS.includes(key)) return ready.has(key);
    return true;
  });
}

export function isCareerPublic(
  role: RoleKey,
  counts: readonly CareerRevealCount[] | null,
  overrides: CareerVisibilityOverrides = CAREER_VISIBILITY_OVERRIDES,
): boolean {
  return publicCareerKeys(counts, overrides).includes(role);
}
