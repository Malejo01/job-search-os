import { z } from "zod";
import { CAREER_REVEAL_THRESHOLD } from "../career-reveal";

/**
 * Cobertura del pool por carrera (R16-4), para el panel de admin: cuántas ofertas «activas» hay por carrera y por
 * fuente en los últimos 7 y 30 días, y cuántas están en español. Puro: arma la tabla a partir de conteos que ya
 * agregó la base; no lee nada ni conoce personas (el pool es global).
 *
 * Definiciones (las mismas que se muestran en la pantalla):
 * - **Activa en N días:** oferta del pool que no es copia de otra (`dedup_of_id` nulo) y que alguna fuente seguía
 *   listando dentro de la ventana, es decir con `last_seen_at` de los últimos N días. No mide cuándo se publicó
 *   (`posted_at`) ni cuándo entró (`first_seen_at`).
 * - **Una oferta con varias carreras cuenta una vez por carrera**, así que las filas de carreras distintas no se
 *   pueden sumar entre sí.
 * - **En español:** el idioma calculado del aviso y, si falta, el que declara la fuente; sin dato no cuenta (el
 *   número es un piso).
 */
export const POOL_COVERAGE_SHORT_DAYS = 7;
export const POOL_COVERAGE_LONG_DAYS = 30;
/** Con menos de estas ofertas activas en 30 días, la carrera tiene poco pool (el umbral de ADR-022). */
export const POOL_COVERAGE_LOW_ACTIVE_30D = CAREER_REVEAL_THRESHOLD;

const count = z.number().int().min(0).max(1_000_000);

/** Una fila agregada de la base: una carrera en una fuente. Todo número, ningún texto de ningún aviso. */
export const poolCoverageCountSchema = z.strictObject({
  role: z.string().min(1).max(60),
  source: z.string().min(1).max(60),
  active7: count,
  active30: count,
  spanish7: count,
  spanish30: count,
});
export type PoolCoverageCount = z.infer<typeof poolCoverageCountSchema>;

export type PoolCoverageSource = { source: string; active7: number; active30: number };

export type PoolCoverageRow = {
  role: string;
  active7: number;
  active30: number;
  spanish7: number;
  spanish30: number;
  /** Por fuente, de más a menos ofertas en 30 días. */
  sources: PoolCoverageSource[];
  /** Menos de `POOL_COVERAGE_LOW_ACTIVE_30D` ofertas activas en 30 días. */
  low: boolean;
};

/**
 * Valida lo que devolvió la base. Falla cerrado: una fila con forma inesperada, un número negativo o una ventana
 * de 7 días mayor que la de 30 descarta todo (`null`) en vez de mostrar números inventados.
 */
export function parsePoolCoverageCounts(raw: unknown): PoolCoverageCount[] | null {
  const parsed = z.array(poolCoverageCountSchema).safeParse(raw);
  if (!parsed.success) return null;
  const coherent = parsed.data.every(
    (r) => r.active7 <= r.active30 && r.spanish7 <= r.active7 && r.spanish30 <= r.active30,
  );
  return coherent ? parsed.data : null;
}

/**
 * Una fila por carrera de `roles`, en ese orden y también las que no tienen ninguna oferta (cero, con `low`).
 * Los conteos de carreras que no están en `roles` se ignoran; varias filas de la misma carrera y fuente se suman.
 */
export function buildPoolCoverage(
  roles: readonly string[],
  counts: readonly PoolCoverageCount[],
): PoolCoverageRow[] {
  return roles.map((role) => {
    const bySource = new Map<string, PoolCoverageSource>();
    let spanish7 = 0;
    let spanish30 = 0;
    for (const c of counts) {
      if (c.role !== role) continue;
      const prev = bySource.get(c.source) ?? { source: c.source, active7: 0, active30: 0 };
      bySource.set(c.source, {
        source: c.source,
        active7: prev.active7 + c.active7,
        active30: prev.active30 + c.active30,
      });
      spanish7 += c.spanish7;
      spanish30 += c.spanish30;
    }
    const sources = [...bySource.values()].sort(
      (a, b) => b.active30 - a.active30 || a.source.localeCompare(b.source),
    );
    const active7 = sources.reduce((n, s) => n + s.active7, 0);
    const active30 = sources.reduce((n, s) => n + s.active30, 0);
    return {
      role,
      active7,
      active30,
      spanish7,
      spanish30,
      sources,
      low: active30 < POOL_COVERAGE_LOW_ACTIVE_30D,
    };
  });
}
