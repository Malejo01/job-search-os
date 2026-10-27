import { CV_MAX_BULLETS, CV_MAX_HISTORY_ENTRIES } from "./model";
import { CV_BULLET_MAX_CHARS, hasLinkOrEmail } from "./verify";

/**
 * Validación de una entrada de `career_history` cargada a mano (C-25, CVC-2). Pura: devuelve el campo
 * que falló, nunca el valor que escribió la persona. Los topes de forma (largos, meses, viñetas) son los
 * mismos CHECK de la tabla (rls/0014 y schema); el de 20 entradas, el de 220 caracteres por viñeta y el
 * filtro de links y emails (en empresa, cargo y viñetas) viven acá porque la base no los puede expresar.
 */
export const HISTORY_KINDS = ["trabajo", "educacion", "certificacion"] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  trabajo: "Trabajo",
  educacion: "Estudio",
  certificacion: "Certificación",
};

export const HISTORY_MAX_ENTRIES = CV_MAX_HISTORY_ENTRIES;
export const HISTORY_MAX_BULLETS = CV_MAX_BULLETS;
export const HISTORY_BULLET_MAX_CHARS = CV_BULLET_MAX_CHARS;
export const HISTORY_FIELD_MAX_CHARS = 120;

export type HistoryField =
  "kind" | "organization" | "title" | "startMonth" | "endMonth" | "dates" | "bullets" | "limit";

export type HistoryInput = {
  kind: HistoryKind;
  organization: string;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
  bullets: string[];
};

export type HistoryCheck = { ok: true; value: HistoryInput } | { ok: false; field: HistoryField };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// Caracteres de control e invisibles (sin escribirlos en el fuente)
const CONTROL_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]",
  "g",
);

function text(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim() : "";
}

function month(raw: unknown): string | null | "bad" {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "") return null;
  return MONTH_RE.test(v) ? v : "bad";
}

/** Una viñeta por línea; vacías fuera. */
export function parseBullets(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l !== "");
}

export function validateHistory(form: { get(name: string): unknown }): HistoryCheck {
  const kind = text(form.get("kind"));
  if (!(HISTORY_KINDS as readonly string[]).includes(kind)) return { ok: false, field: "kind" };
  const organization = text(form.get("organization"));
  if (
    organization === "" ||
    organization.length > HISTORY_FIELD_MAX_CHARS ||
    hasLinkOrEmail(organization)
  ) {
    return { ok: false, field: "organization" };
  }
  const title = text(form.get("title"));
  if (title === "" || title.length > HISTORY_FIELD_MAX_CHARS || hasLinkOrEmail(title)) {
    return { ok: false, field: "title" };
  }
  const startMonth = month(form.get("startMonth"));
  if (startMonth === "bad") return { ok: false, field: "startMonth" };
  const endMonth = month(form.get("endMonth"));
  if (endMonth === "bad") return { ok: false, field: "endMonth" };
  if (endMonth && !startMonth) return { ok: false, field: "dates" };
  if (startMonth && endMonth && endMonth < startMonth) return { ok: false, field: "dates" };
  const bullets = parseBullets(form.get("bullets"));
  if (
    bullets.length > HISTORY_MAX_BULLETS ||
    bullets.some((b) => b.length > HISTORY_BULLET_MAX_CHARS || hasLinkOrEmail(b))
  ) {
    return { ok: false, field: "bullets" };
  }
  return {
    ok: true,
    value: { kind: kind as HistoryKind, organization, title, startMonth, endMonth, bullets },
  };
}

export const HISTORY_ERROR_MESSAGES: Record<HistoryField, string> = {
  kind: "Elegí si es un trabajo, un estudio o una certificación.",
  organization: `Escribí la empresa o institución (hasta ${HISTORY_FIELD_MAX_CHARS} caracteres, sin links ni emails).`,
  title: `Escribí el cargo o título (hasta ${HISTORY_FIELD_MAX_CHARS} caracteres, sin links ni emails).`,
  startMonth: "El mes de inicio no es válido.",
  endMonth: "El mes de fin no es válido.",
  dates: "El fin no puede ser anterior al inicio, y para poner un fin hace falta un inicio.",
  bullets: `Hasta ${HISTORY_MAX_BULLETS} viñetas, una por línea, de hasta ${HISTORY_BULLET_MAX_CHARS} caracteres y sin links ni emails.`,
  limit: `Llegaste al máximo de ${HISTORY_MAX_ENTRIES} entradas. Borrá alguna para sumar otra.`,
};

export function isHistoryField(v: string | undefined): v is HistoryField {
  return v !== undefined && v in HISTORY_ERROR_MESSAGES;
}
