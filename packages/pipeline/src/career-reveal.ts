/**
 * Cuándo mostrar cada carrera nueva (C4-3). Puro: recibe cuántas ofertas tuvo cada carrera oculta y dice
 * si ya llegó al umbral de ADR-022 (10 ofertas en 30 días). No decide nada solo: sacar una carrera del
 * modo oculto es un cambio de una línea en `UNLISTED_ROLE_KEYS` que hace una persona (ver el PR).
 */

/** Ofertas mínimas en la ventana para mostrar una carrera en los selectores (ADR-022 §7). */
export const CAREER_REVEAL_THRESHOLD = 10;
/** Ventana en días. */
export const CAREER_REVEAL_WINDOW_DAYS = 30;

export type CareerRevealCount = {
  role: string;
  /** Ofertas nuevas del pool (vistas por primera vez en la ventana, sin copias). Es la que se compara con el umbral. */
  received: number;
  /** Ofertas del pool vistas por última vez en la ventana (las que muestra la página de mercado). */
  active: number;
};

export type CareerRevealRow = CareerRevealCount & {
  threshold: number;
  /** «Lista para mostrarse»: las ofertas recibidas llegan al umbral. */
  ready: boolean;
  /** Cuántas ofertas faltan para el umbral (0 si ya llegó). */
  missing: number;
};

function count(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Una fila por cada carrera oculta (`hidden`), aunque no tenga ofertas, con su conteo y si ya llegó al
 * umbral. Las listas primero y, dentro de cada grupo, las que más ofertas tienen.
 */
export function buildCareerRevealRows(
  hidden: readonly string[],
  counts: readonly CareerRevealCount[],
  threshold: number = CAREER_REVEAL_THRESHOLD,
): CareerRevealRow[] {
  const byRole = new Map<string, CareerRevealCount>();
  for (const c of counts) {
    const prev = byRole.get(c.role);
    byRole.set(c.role, {
      role: c.role,
      received: Math.max(count(c.received), prev?.received ?? 0),
      active: Math.max(count(c.active), prev?.active ?? 0),
    });
  }
  return [...new Set(hidden)]
    .map((role): CareerRevealRow => {
      const c = byRole.get(role) ?? { role, received: 0, active: 0 };
      return {
        ...c,
        threshold,
        ready: c.received >= threshold,
        missing: Math.max(0, threshold - c.received),
      };
    })
    .sort(
      (a, b) =>
        Number(b.ready) - Number(a.ready) ||
        b.received - a.received ||
        (a.role < b.role ? -1 : a.role > b.role ? 1 : 0),
    );
}
