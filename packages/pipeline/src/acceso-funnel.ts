/**
 * Embudo de /acceso (C8-2): contadores agregados por hora, origen, paso y carrera, sin personas (ni
 * email, ni IP, ni id). Sirve para ver el pico del QR del 11/11 y cuánto se pierde en cada paso.
 * Puro: la web lee las filas de la base (`acceso_funnel_admin()`) y acá se validan y se suman.
 */

/**
 * Pasos que se cuentan:
 * - `visita`: la página cargó (una vez por pestaña);
 * - `empezado`: tocó el primer campo del formulario;
 * - `carrera`: eligió una carrera en el selector (con la carrera);
 * - `enviado`: el pedido entró a la lista (con la carrera; también los duplicados, que la web no distingue);
 * - `tope`: el pedido rebotó por los topes anti-abuso.
 */
export const ACCESO_FUNNEL_STEPS = ["visita", "empezado", "carrera", "enviado", "tope"] as const;
export type AccesoFunnelStep = (typeof ACCESO_FUNNEL_STEPS)[number];

export function isAccesoFunnelStep(value: unknown): value is AccesoFunnelStep {
  return typeof value === "string" && (ACCESO_FUNNEL_STEPS as readonly string[]).includes(value);
}

/**
 * Orígenes que se guardan tal cual (`?origen=`). Cualquier otro valor cae en «otro» para que la base
 * nunca guarde texto libre que llegue por la URL. Sin `?origen=` es «directo».
 */
export const ACCESO_ORIGINS = [
  "voces-jovenes",
  "instagram",
  "linkedin",
  "whatsapp",
  "compartido",
  "directo",
  "otro",
] as const;
export type AccesoOrigin = (typeof ACCESO_ORIGINS)[number];

export const ACCESO_ORIGIN_LABELS: Record<AccesoOrigin, string> = {
  "voces-jovenes": "Voces Jóvenes (QR)",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  compartido: "Compartido por alguien",
  directo: "Directo (sin origen)",
  otro: "Otro",
};

export function normalizeAccesoOrigin(raw: string | null | undefined): AccesoOrigin {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "directo";
  return (ACCESO_ORIGINS as readonly string[]).includes(value) ? (value as AccesoOrigin) : "otro";
}

export type AccesoFunnelRow = {
  /** Comienzo de la hora, en ISO (UTC). */
  hour: string;
  origin: string;
  step: AccesoFunnelStep;
  /** Clave de carrera en `carrera` y `enviado`; vacío en el resto. */
  role: string;
  count: number;
};

const ORIGIN_RE = /^[a-z0-9-]{1,40}$/;
const ROLE_RE = /^[a-z_]{0,40}$/;

/** Valida lo que vuelve de la base. Si una fila no tiene la forma esperada, null (falla cerrado). */
export function parseAccesoFunnelRows(raw: unknown): AccesoFunnelRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: AccesoFunnelRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    const hourDate =
      o.hour instanceof Date ? o.hour : typeof o.hour === "string" ? new Date(o.hour) : null;
    if (!hourDate || Number.isNaN(hourDate.getTime())) return null;
    if (typeof o.origin !== "string" || !ORIGIN_RE.test(o.origin)) return null;
    if (!isAccesoFunnelStep(o.step)) return null;
    const role = o.role ?? "";
    if (typeof role !== "string" || !ROLE_RE.test(role)) return null;
    const count = typeof o.count === "string" ? Number(o.count) : o.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
    rows.push({ hour: hourDate.toISOString(), origin: o.origin, step: o.step, role, count });
  }
  return rows;
}

type StepCounts = Record<AccesoFunnelStep, number>;
const emptyCounts = (): StepCounts => ({ visita: 0, empezado: 0, carrera: 0, enviado: 0, tope: 0 });

export type AccesoOriginSummary = StepCounts & {
  origin: string;
  /** Envíos / visitas; 0 si no hubo visitas registradas. */
  conversion: number;
};
export type AccesoRoleSummary = {
  role: string;
  /** Veces que se eligió la carrera en el selector. */
  carrera: number;
  enviado: number;
  /** Envíos / elecciones; null si no hay elecciones registradas (p. ej., antes de prender el embudo). */
  conversion: number | null;
};
export type AccesoHourSummary = StepCounts & { hour: string };

export type AccesoFunnel = {
  byOrigin: AccesoOriginSummary[];
  byRole: AccesoRoleSummary[];
  byHour: AccesoHourSummary[];
  /** La hora con más visitas (la primera, si empatan). */
  peakHour: string | null;
  totals: StepCounts;
};

export function buildAccesoFunnel(
  rows: readonly AccesoFunnelRow[],
  opts: { origin?: string } = {},
): AccesoFunnel {
  const selected = opts.origin ? rows.filter((r) => r.origin === opts.origin) : rows;
  const origins = new Map<string, StepCounts>();
  const roles = new Map<string, { carrera: number; enviado: number }>();
  const hours = new Map<string, StepCounts>();
  const totals = emptyCounts();

  for (const r of selected) {
    const o = origins.get(r.origin) ?? emptyCounts();
    o[r.step] += r.count;
    origins.set(r.origin, o);
    const h = hours.get(r.hour) ?? emptyCounts();
    h[r.step] += r.count;
    hours.set(r.hour, h);
    totals[r.step] += r.count;
    if (r.role && (r.step === "carrera" || r.step === "enviado")) {
      const role = roles.get(r.role) ?? { carrera: 0, enviado: 0 };
      role[r.step] += r.count;
      roles.set(r.role, role);
    }
  }

  const byOrigin = [...origins.entries()]
    .map(([origin, c]) => ({ origin, ...c, conversion: c.visita > 0 ? c.enviado / c.visita : 0 }))
    .sort((a, b) => b.visita - a.visita || a.origin.localeCompare(b.origin));
  const byRole = [...roles.entries()]
    .map(([role, c]) => ({
      role,
      ...c,
      conversion: c.carrera > 0 ? c.enviado / c.carrera : null,
    }))
    .sort((a, b) => b.enviado - a.enviado || b.carrera - a.carrera || a.role.localeCompare(b.role));
  const byHour = [...hours.entries()]
    .map(([hour, c]) => ({ hour, ...c }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
  let peakHour: string | null = null;
  let peak = 0;
  for (const h of byHour) {
    if (h.visita > peak) {
      peak = h.visita;
      peakHour = h.hour;
    }
  }
  return { byOrigin, byRole, byHour, peakHour, totals };
}
