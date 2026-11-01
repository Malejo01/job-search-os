/**
 * Panel de la lista de espera (C4-2). Puro: filtros, contadores, tope de invitaciones por tanda, CSV y
 * texto de la invitación. No lee la base ni el reloj; la lista llega ya cargada de `waitlist_admin_list`
 * (solo id, nombre, email, carrera, origen, fecha de alta y de invitación; nunca la IP).
 *
 * La lista de espera se guarda como siempre (rls/0006): acá no cambia nada del esquema.
 */
import { PRODUCT_NAME } from "./product";

/** Lo que el panel necesita de cada persona anotada. */
export type WaitlistAdminEntry = {
  id: string;
  name: string;
  email: string;
  /** Clave de carrera (ROLE_KEYS). */
  role: string;
  /** «Cómo te enteraste», texto libre de hasta 200 caracteres. */
  heardFrom: string | null;
  createdAt: Date;
  invitedAt: Date | null;
};

/** Cuándo abre la beta, tal como va en el texto de la invitación. */
export const BETA_OPENING_LABEL = "jueves 26/11";

/** Valor del filtro de origen para quienes no completaron «cómo te enteraste». */
export const ORIGIN_NONE = "__sin_dato__";

export const WAITLIST_STATUSES = ["todas", "sin_invitar", "invitadas"] as const;
export type WaitlistStatusFilter = (typeof WAITLIST_STATUSES)[number];

export type WaitlistFilters = {
  role?: string;
  /** Origen ya normalizado (`normalizeOrigin`) o `ORIGIN_NONE`. */
  origin?: string;
  /** Fecha de alta mínima, `YYYY-MM-DD` (día de Argentina), incluida. */
  from?: string;
  /** Fecha de alta máxima, `YYYY-MM-DD` (día de Argentina), incluida. */
  to?: string;
  status?: WaitlistStatusFilter;
};

const AR_OFFSET_MS = 3 * 3_600_000;
const ORIGIN_MAX = 200;

/** Día de Argentina (UTC−3, sin horario de verano) como `YYYY-MM-DD`. */
function arDay(date: Date): string {
  return new Date(date.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Clave para agrupar lo que la gente escribió en «cómo te enteraste»: sin mayúsculas, tildes ni espacios
 * de más. Vacío o solo espacios es «sin dato» (null).
 */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return key === "" ? null : key;
}

export function filterWaitlist(
  entries: readonly WaitlistAdminEntry[],
  filters: WaitlistFilters,
): WaitlistAdminEntry[] {
  return entries.filter((e) => {
    if (filters.role && e.role !== filters.role) return false;
    if (filters.origin) {
      const key = normalizeOrigin(e.heardFrom);
      if (filters.origin === ORIGIN_NONE ? key !== null : key !== filters.origin) return false;
    }
    if (filters.from || filters.to) {
      const day = arDay(e.createdAt);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
    }
    if (filters.status === "sin_invitar" && e.invitedAt) return false;
    if (filters.status === "invitadas" && !e.invitedAt) return false;
    return true;
  });
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Filtros desde los parámetros de la URL. Lo que no es válido se descarta: nunca rompe la página. */
export function parseWaitlistFilters(
  params: Record<string, string | string[] | undefined>,
): WaitlistFilters {
  const out: WaitlistFilters = {};
  const role = single(params.carrera)?.trim();
  if (role && /^[a-z0-9_]{1,40}$/.test(role)) out.role = role;
  const origin = normalizeOrigin(single(params.origen)?.slice(0, ORIGIN_MAX));
  if (origin) out.origin = origin;
  const from = single(params.desde)?.trim();
  if (from && isRealDate(from)) out.from = from;
  const to = single(params.hasta)?.trim();
  if (to && isRealDate(to)) out.to = to;
  const status = single(params.estado)?.trim();
  // «todas» es lo mismo que no filtrar: no cuenta como filtro activo
  if (status && status !== "todas" && (WAITLIST_STATUSES as readonly string[]).includes(status)) {
    out.status = status as WaitlistStatusFilter;
  }
  return out;
}

export type RoleCount = { role: string; total: number; pending: number };

/** Cuántas personas hay por carrera (total y sin invitar), las que más esperan primero. */
export function countWaitlistByRole(entries: readonly WaitlistAdminEntry[]): RoleCount[] {
  const map = new Map<string, RoleCount>();
  for (const e of entries) {
    const row = map.get(e.role) ?? { role: e.role, total: 0, pending: 0 };
    row.total++;
    if (!e.invitedAt) row.pending++;
    map.set(e.role, row);
  }
  return [...map.values()].sort(
    (a, b) => b.pending - a.pending || b.total - a.total || (a.role < b.role ? -1 : 1),
  );
}

export type OriginOption = { key: string; label: string; count: number };

/** Opciones del filtro de origen: variantes agrupadas, la más usada de cada una como etiqueta. */
export function originOptions(entries: readonly WaitlistAdminEntry[], limit = 20): OriginOption[] {
  const groups = new Map<string, { count: number; variants: Map<string, number> }>();
  for (const e of entries) {
    const key = normalizeOrigin(e.heardFrom);
    if (!key) continue;
    const label = (e.heardFrom ?? "").replace(/\s+/g, " ").trim().slice(0, ORIGIN_MAX);
    const group = groups.get(key) ?? { count: 0, variants: new Map() };
    group.count++;
    group.variants.set(label, (group.variants.get(label) ?? 0) + 1);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      // La variante más repetida; si empatan, la primera que apareció
      let label = "";
      let best = 0;
      for (const [variant, n] of g.variants) {
        if (n > best) {
          best = n;
          label = variant;
        }
      }
      return { key, label, count: g.count };
    })
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1))
    .slice(0, Math.max(0, limit));
}

/** Invitaciones por tanda si no se configura otro tope. */
export const INVITE_CAP_DEFAULT = 20;
/** Máximo posible por tanda, configure lo que configure el panel. */
export const INVITE_CAP_MAX = 100;

/**
 * Tope de invitaciones de una tanda: entero entre 1 y `INVITE_CAP_MAX`. Un valor inválido cae al default
 * (que a su vez puede venir de una variable de entorno, también acotada).
 */
export function clampInviteCap(
  raw: string | number | null | undefined,
  envDefault?: string,
): number {
  const parse = (v: string | number | null | undefined): number | null => {
    const text = typeof v === "number" ? String(v) : v?.trim();
    if (!text || !/^\d+$/.test(text)) return null;
    const n = Number(text);
    return n >= 1 ? Math.min(n, INVITE_CAP_MAX) : null;
  };
  return parse(raw) ?? parse(envDefault) ?? INVITE_CAP_DEFAULT;
}

/** Marca de orden de bytes UTF-8: sin ella Excel lee mal las tildes. */
const BOM = String.fromCharCode(0xfeff);
const CSV_HEADER = ["nombre", "email", "carrera", "origen", "fecha"] as const;

/** Una celda de CSV: sin fórmulas de planilla (=, +, -, @) y entrecomillada cuando hace falta. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV con solo nombre, email, carrera, origen y fecha de alta (día de Argentina). Empieza con BOM para
 * que Excel lea las tildes y usa CRLF. `roleLabel` pone el nombre legible de la carrera.
 */
export function waitlistCsv(
  entries: readonly WaitlistAdminEntry[],
  roleLabel: (role: string) => string,
): string {
  const rows = entries.map((e) =>
    [e.name, e.email, roleLabel(e.role), e.heardFrom ?? "", arDay(e.createdAt)]
      .map(csvCell)
      .join(","),
  );
  return `${BOM}${[CSV_HEADER.join(","), ...rows].join("\r\n")}\r\n`;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function longDate(date: Date): string {
  const ar = new Date(date.getTime() - AR_OFFSET_MS);
  return `${ar.getUTCDate()} de ${MONTHS[ar.getUTCMonth()]}`;
}

/**
 * Texto de la invitación para mandar por el medio que prefiera quien administra (el panel no manda
 * emails). Dice cuándo abre la beta, que el link es personal y cuándo vence. No promete resultados.
 */
export function buildWaitlistInvitationText(input: {
  name: string;
  link: string;
  expiresAt: Date;
}): string {
  const first = input.name.trim().split(/\s+/)[0]?.slice(0, 40) ?? "";
  return [
    first ? `Hola ${first}:` : "Hola,",
    "",
    `Te invitamos a la beta cerrada de ${PRODUCT_NAME}. La beta abre el ${BETA_OPENING_LABEL}; podés crear tu cuenta desde ahora con este link:`,
    "",
    input.link,
    "",
    `El link es personal: sirve una sola vez y vence el ${longDate(input.expiresAt)}.`,
    "",
    PRODUCT_NAME,
  ].join("\n");
}
