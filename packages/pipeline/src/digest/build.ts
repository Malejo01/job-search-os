/**
 * Resumen de novedades (C-6, ticket E4). Puro: un solo contenido para los dos canales, el bloque
 * «En resumen» de «Hoy» y, cuando se encienda, el email. Lleva solo conteos: nunca títulos,
 * empresas, puntajes, sueldos ni niveles. El asunto es neutro y sin números, para que la vista
 * previa de un buzón no delate una búsqueda.
 */
export type DigestFrequency = "diario" | "semanal";

export type DigestInput = {
  /** Ofertas nuevas evaluadas en el período. */
  newEvaluated: number;
  /** De esas, cuántas tienen acción aplicar o aplicar a medida. */
  toApply: number;
  /** Postulaciones para hacer seguimiento. */
  followUps: number;
  /** Ofertas nuevas del pool en 7 días por carrera; solo entran en el semanal. */
  careers: readonly { label: string; last7d: number }[];
  frequency: DigestFrequency;
  now: Date;
  /** Zona IANA de la persona: define el día y la semana del período. */
  timeZone: string;
  productName: string;
};

export type Digest = {
  /** Sin novedades personales no hay resumen (ni email). */
  hasNews: boolean;
  /** Las novedades de la persona (ofertas y seguimientos). */
  personal: string[];
  /** Todo lo que va al resumen: lo personal y, en el semanal, el mercado de sus carreras. */
  lines: string[];
  subject: string;
  /** Período en la zona de la persona: «2026-10-23» (diario) o «2026-W43» (semanal). */
  periodKey: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Fecha local (año, mes y día) en la zona; una zona inválida cae a UTC. */
export function localDate(now: Date, timeZone: string): { y: number; m: number; d: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Semana ISO 8601 (lunes a domingo; la semana 1 es la que tiene el primer jueves del año). */
export function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

export function digestPeriodKey(frequency: DigestFrequency, now: Date, timeZone: string): string {
  const { y, m, d } = localDate(now, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (frequency === "diario") return `${y}-${pad(m)}-${pad(d)}`;
  const { year, week } = isoWeek(y, m, d);
  return `${year}-W${pad(week)}`;
}

export function buildDigest(input: DigestInput): Digest {
  const personal: string[] = [];
  if (input.newEvaluated > 0) {
    const offers = plural(input.newEvaluated, "oferta nueva evaluada", "ofertas nuevas evaluadas");
    const apply = input.toApply > 0 ? ` (${input.toApply} para postularte)` : "";
    personal.push(`${offers}${apply}`);
  }
  if (input.followUps > 0) {
    const apps = plural(input.followUps, "postulación", "postulaciones");
    personal.push(`${apps} para hacer seguimiento`);
  }
  const market: string[] = [];
  if (input.frequency === "semanal") {
    for (const c of input.careers) {
      if (c.last7d > 0) market.push(`${c.label}: ${c.last7d} ofertas nuevas en 7 días`);
    }
  }
  const period = input.frequency === "diario" ? "del día" : "de la semana";
  return {
    hasNews: personal.length > 0,
    personal,
    lines: [...personal, ...market],
    subject: `Tu resumen ${period} en ${input.productName}`,
    periodKey: digestPeriodKey(input.frequency, input.now, input.timeZone),
  };
}

/** Una sola frase para el bloque «En resumen» de «Hoy»; null si no hay novedades personales. */
export function digestSentence(digest: Digest): string | null {
  if (!digest.hasNews) return null;
  return `Desde tu última visita: ${digest.personal.join(" y ")}.`;
}
