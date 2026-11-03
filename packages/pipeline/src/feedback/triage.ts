import { isRoleKey } from "../skills/self-assessment";
import { isFeedbackCategory, type FeedbackAction, type FeedbackCategory } from "./beta-feedback";

/**
 * Triage del feedback de la beta (C8-17), puro: filtros del panel del admin, las últimas acciones del
 * chip de soporte en llano y el CSV sin fórmulas de planilla. La persona va siempre con su
 * identificador seudónimo (6 caracteres del sha256 del user_id), nunca con email ni nombre.
 */
export const FEEDBACK_STATUSES = ["nuevo", "visto", "resuelto"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  nuevo: "Nuevo",
  visto: "Visto",
  resuelto: "Resuelto",
};

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export type TriageRow = {
  id: string;
  createdAt: Date;
  category: string;
  path: string;
  message: string;
  person: string;
  /** Carrera principal de quien escribió (target_role); null si no eligió. */
  career: string | null;
  status: FeedbackStatus;
  actions: readonly FeedbackAction[];
};

export type FeedbackFilters = {
  career: string | null;
  category: FeedbackCategory | null;
  /** Prefijo de la página (`/jobs` incluye `/jobs/123`). */
  path: string | null;
  /** Días de Argentina, `AAAA-MM-DD`, inclusivos. */
  from: string | null;
  to: string | null;
  status: FeedbackStatus | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseFeedbackFilters(
  params: Record<string, string | string[] | undefined>,
): FeedbackFilters {
  const career = one(params.carrera);
  const category = one(params.categoria);
  const path = one(params.pagina).trim().slice(0, 200);
  const from = one(params.desde);
  const to = one(params.hasta);
  const status = one(params.estado);
  return {
    career: isRoleKey(career) ? career : null,
    category: isFeedbackCategory(category) ? category : null,
    path: path.startsWith("/") ? path : null,
    from: DAY.test(from) ? from : null,
    to: DAY.test(to) ? to : null,
    status: isFeedbackStatus(status) ? status : null,
  };
}

/** `AAAA-MM-DD` del día de Argentina (UTC−3, sin horario de verano). */
function argentinaDay(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export function filterFeedback(rows: readonly TriageRow[], f: FeedbackFilters): TriageRow[] {
  return rows.filter((r) => {
    if (f.career && r.career !== f.career) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.path && !r.path.startsWith(f.path)) return false;
    if (f.status && r.status !== f.status) return false;
    const day = argentinaDay(r.createdAt);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
}

function hhmm(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t - 3 * 3_600_000).toISOString().slice(11, 16);
}

/** «10:59 · tocó «Ver oferta»»: lo que hizo la persona antes de escribir, en orden. */
export function readableActions(actions: readonly FeedbackAction[]): string[] {
  return actions.map((a) => {
    const text = a.text.trim();
    const what =
      a.type === "navigate"
        ? `fue a ${text || "otra pantalla"}`
        : text
          ? `tocó «${text}»`
          : "tocó un elemento sin texto";
    const at = hhmm(a.time);
    return at ? `${at} · ${what}` : what;
  });
}

const BOM = String.fromCharCode(0xfeff);

/** Una celda de CSV: sin fórmulas de planilla (=, +, -, @, tab, CR) y entrecomillada. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV del panel (lo filtrado): fecha, carrera, categoría, estado, página, persona, mensaje y acciones. */
export function feedbackCsv(rows: readonly TriageRow[]): string {
  const header = "fecha,carrera,categoria,estado,pagina,persona,mensaje,acciones";
  const lines = rows.map((r) =>
    [
      argentinaDay(r.createdAt),
      r.career ?? "",
      r.category,
      r.status,
      r.path,
      r.person,
      r.message,
      readableActions(r.actions).join(" | "),
    ]
      .map(cell)
      .join(","),
  );
  return `${BOM}${[header, ...lines].join("\r\n")}\r\n`;
}
