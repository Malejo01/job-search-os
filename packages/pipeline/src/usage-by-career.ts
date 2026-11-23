import { z } from "zod";

/**
 * Uso por carrera y por semana (R22-04). Puro: valida lo que devuelve `admin_usage_by_career()`
 * (rls/0057) y arma la grilla del tablero de admin. Sin I/O ni fecha implícita: `now` entra por parámetro.
 *
 * Privacidad: una celda (carrera × semana × métrica) con menos de `USAGE_K` personas distintas se muestra
 * como «menos de 3», sin su conteo de acciones (una persona con 40 evaluaciones sería identificable por
 * el 40). La celda que no tiene fila también es «menos de 3»: así no se distingue el cero de 1 o 2
 * personas. La base ya manda `value` y `people` en null cuando enmascara; acá se vuelve a aplicar la
 * regla por si alguna vez llegara sin enmascarar. No hay fila de total entre carreras: restarla de las
 * celdas visibles destaparía una celda chica.
 */

export const USAGE_K = 3;
export const USAGE_WEEKS = 8;
/** Zona horaria de las semanas: Argentina, sin horario de verano. */
const UTC_OFFSET_HOURS = -3;

export const USAGE_METRICS = [
  "active",
  "evaluated",
  "up",
  "down",
  "applications",
  "interviews",
  "coach_chats",
  "cv_reviews",
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

/** Carrera sin clave válida (texto libre, vacía o clave vieja): mismo nombre que en los cupos de fundador. */
export const USAGE_NO_CAREER_KEY = "sin_carrera";

export const UsageRowsSchema = z.array(
  z.object({
    week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    career: z.string().regex(/^[a-z0-9_]{1,40}$/),
    metric: z.enum(USAGE_METRICS),
    value: z.number().int().nonnegative().nullable(),
    people: z.number().int().nonnegative().nullable(),
  }),
);
export type UsageRow = z.infer<typeof UsageRowsSchema>[number];

/** Falla cerrado: si la forma no es la esperada, null (la pantalla dice que no hay datos). */
export function parseUsageRows(raw: unknown): UsageRow[] | null {
  const parsed = UsageRowsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Lunes (YYYY-MM-DD, hora de Buenos Aires) de las últimas `n` semanas, de la más vieja a la actual. */
export function usageWeeks(now: Date, n: number = USAGE_WEEKS): string[] {
  const local = new Date(now.getTime() + UTC_OFFSET_HOURS * 3_600_000);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = day - sinceMonday * 86_400_000;
  return Array.from({ length: n }, (_, i) =>
    new Date(monday - (n - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
  );
}

export type UsageCell = { kind: "value"; value: number } | { kind: "small" };

export type UsageCareerRow = {
  career: string;
  /** Por semana (lunes) y por métrica. Siempre trae las semanas y las métricas completas. */
  cells: Record<string, Record<UsageMetric, UsageCell>>;
};

export type UsageGrid = { weeks: string[]; careers: UsageCareerRow[] };

function cellOf(row: UsageRow | undefined): UsageCell {
  if (!row || row.value === null || row.people === null || row.people < USAGE_K) {
    return { kind: "small" };
  }
  return { kind: "value", value: row.value };
}

/**
 * Grilla por carrera. Las carreras salen ordenadas por personas activas visibles en la última semana que
 * tenga el dato (de más a menos), con «sin carrera» al final; las que no tienen ninguna celda visible se
 * omiten (no hay nada que mostrar y no se dice cuántas son).
 */
export function buildUsageGrid(rows: readonly UsageRow[], now: Date): UsageGrid {
  const weeks = usageWeeks(now);
  const inWindow = new Set(weeks);
  const byKey = new Map<string, UsageRow>();
  const careers = new Set<string>();
  for (const r of rows) {
    if (!inWindow.has(r.week)) continue;
    byKey.set(`${r.career}|${r.week}|${r.metric}`, r);
    careers.add(r.career);
  }
  const out: (UsageCareerRow & { rank: number })[] = [];
  for (const career of careers) {
    const cells: UsageCareerRow["cells"] = {};
    let visible = false;
    let rank = -1;
    for (const week of weeks) {
      const perMetric = {} as Record<UsageMetric, UsageCell>;
      for (const metric of USAGE_METRICS) {
        const cell = cellOf(byKey.get(`${career}|${week}|${metric}`));
        if (cell.kind === "value") visible = true;
        perMetric[metric] = cell;
      }
      cells[week] = perMetric;
      const active = perMetric.active;
      if (active.kind === "value") rank = active.value;
    }
    if (visible) out.push({ career, cells, rank });
  }
  out.sort((a, b) => {
    const noA = a.career === USAGE_NO_CAREER_KEY ? 1 : 0;
    const noB = b.career === USAGE_NO_CAREER_KEY ? 1 : 0;
    return noA - noB || b.rank - a.rank || a.career.localeCompare(b.career);
  });
  return { weeks, careers: out.map(({ career, cells }) => ({ career, cells })) };
}
