import { z } from "zod";

/**
 * Métricas de la beta para el admin y para financiamiento (C-14). Puro: valida lo que devuelve
 * `admin_beta_metrics()` (rls/0009) y lo arma en filas y en CSV. Los números que cuentan personas o
 * lo que hicieron llegan null cuando vienen de menos de k personas distintas (k-anonimato, en la
 * base): acá se muestran como «<k», nunca como 0.
 */

const count = z.number().int().nonnegative().nullable();
// Claves del pool (enum de fuentes, código de idioma): cortas y sin caracteres raros
const byKey = z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.number().int().nonnegative());

export const BetaMetricsSchema = z.object({
  generated_at: z.string(),
  k: z.number().int().positive(),
  active_7d: count,
  active_30d: count,
  evaluations_30d: count,
  verdict_up_30d: count,
  verdict_down_30d: count,
  applications_30d: count,
  interviews_30d: count,
  llm_cost_30d_usd: z.number().nonnegative().nullable(),
  llm_cost_per_active_30d_usd: z.number().nonnegative().nullable(),
  offers_by_source_30d: byKey,
  offers_by_lang_30d: byKey,
});

export type BetaMetrics = z.infer<typeof BetaMetricsSchema>;

export type BetaMetricRow = { group: string; metric: string; value: string };

/** Falla cerrado: si la forma no es la esperada, null (la pantalla dice que no hay datos). */
export function parseBetaMetrics(raw: unknown): BetaMetrics | null {
  const parsed = BetaMetricsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function betaMetricRows(m: BetaMetrics): BetaMetricRow[] {
  const hidden = `<${m.k}`;
  const n = (v: number | null) => (v === null ? hidden : String(v));
  const usd = (v: number | null, digits: number) => (v === null ? hidden : v.toFixed(digits));
  const up = m.verdict_up_30d;
  const down = m.verdict_down_30d;
  const upRate =
    up === null || down === null || up + down === 0
      ? hidden
      : `${Math.round((up / (up + down)) * 100)} %`;
  const byCount = (o: Record<string, number>) =>
    Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [
    { group: "Personas", metric: "Activas en 7 días", value: n(m.active_7d) },
    { group: "Personas", metric: "Activas en 30 días", value: n(m.active_30d) },
    { group: "Uso (30 días)", metric: "Evaluaciones", value: n(m.evaluations_30d) },
    { group: "Uso (30 días)", metric: "👍", value: n(up) },
    { group: "Uso (30 días)", metric: "👎", value: n(down) },
    { group: "Uso (30 días)", metric: "% de 👍", value: upRate },
    { group: "Uso (30 días)", metric: "Postulaciones", value: n(m.applications_30d) },
    { group: "Uso (30 días)", metric: "Entrevistas u ofertas", value: n(m.interviews_30d) },
    { group: "Costo de IA (30 días)", metric: "Total (USD)", value: usd(m.llm_cost_30d_usd, 2) },
    {
      group: "Costo de IA (30 días)",
      metric: "Por persona activa (USD)",
      value: usd(m.llm_cost_per_active_30d_usd, 3),
    },
    ...byCount(m.offers_by_source_30d).map(([k, v]) => ({
      group: "Ofertas nuevas por fuente (30 días)",
      metric: k,
      value: String(v),
    })),
    ...byCount(m.offers_by_lang_30d).map(([k, v]) => ({
      group: "Ofertas nuevas por idioma (30 días)",
      metric: k,
      value: String(v),
    })),
  ];
}

/**
 * CSV con separador «,», todo entre comillas y las comillas internas duplicadas (RFC 4180). Una
 * celda que empieza con = + - @ o un tabulador lleva un apóstrofo adelante: así una planilla no la
 * toma por una fórmula.
 */
export function betaMetricsCsv(m: BetaMetrics): string {
  const q = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
  const lines = [
    ["grupo", "metrica", "valor"],
    ...betaMetricRows(m).map((r) => [r.group, r.metric, r.value]),
  ];
  return (
    [`# generado ${m.generated_at} · k=${m.k}`, ...lines.map((l) => l.map(q).join(","))].join(
      "\n",
    ) + "\n"
  );
}
