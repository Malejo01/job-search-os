/**
 * «Contanos qué pasó» (C-23): reglas puras del formulario de comentarios de la beta. Sin I/O: las
 * usan la server action, el modal (solo constantes) y los tests. La base repite los límites con
 * CHECK (`beta_feedback_*`, migración 0045); `packages/db` tiene un test que los compara.
 */
export const FEEDBACK_CATEGORIES = ["algo_no_anduvo", "idea", "confuso"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  algo_no_anduvo: "Algo no anduvo",
  idea: "Tengo una idea",
  confuso: "Algo es confuso",
};

export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_PATH_MAX = 200;
/** Envíos por persona en una ventana de 24 h. */
export const FEEDBACK_DAILY_LIMIT = 10;

export type FeedbackField = "category" | "message" | "path" | "limit";

export type FeedbackInput = { category: FeedbackCategory; message: string; path: string };

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Caracteres bidireccionales y de formato invisibles (U+200B–U+200F, U+202A–U+202E,
 * U+2066–U+2069, U+FEFF): permiten que un texto se vea distinto de lo que dice.
 */
const INVISIBLE_FORMAT_CHARS = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]",
  "g",
);

/**
 * Mismo criterio que el contador del cliente: \r\n y \r son un salto, sin espacios en los bordes;
 * además saca los caracteres bidireccionales e invisibles.
 */
export function normalizeFeedbackMessage(value: string): string {
  return value.replace(INVISIBLE_FORMAT_CHARS, "").replace(/\r\n?/g, "\n").trim();
}

/**
 * Solo el pathname: empieza con `/`, sin query (`?`), sin fragmento (`#`), sin `..`, sin
 * caracteres de control ni barras invertidas, hasta FEEDBACK_PATH_MAX.
 */
export function isValidFeedbackPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > FEEDBACK_PATH_MAX) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (/[?#\\]/.test(value) || value.includes("..")) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(value);
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;

/**
 * Los segmentos con forma de uuid o puramente numéricos pasan a `[id]`: `/jobs/<uuid>` se guarda
 * como `/jobs/[id]`, así la ruta no lleva ids de ofertas ni de otras cosas de la persona.
 */
export function normalizeFeedbackPath(path: string): string {
  return path
    .split("/")
    .map((seg) => (UUID_SEGMENT.test(seg) || NUMERIC_SEGMENT.test(seg) ? "[id]" : seg))
    .join("/");
}

export type FeedbackValidation =
  { ok: true; value: FeedbackInput } | { ok: false; field: Exclude<FeedbackField, "limit"> };

/** Valida los tres campos en orden; devuelve el primero inválido, nunca su contenido. */
export function validateFeedback(raw: {
  category: unknown;
  message: unknown;
  path: unknown;
}): FeedbackValidation {
  if (!isFeedbackCategory(raw.category)) return { ok: false, field: "category" };
  if (typeof raw.message !== "string") return { ok: false, field: "message" };
  const message = normalizeFeedbackMessage(raw.message);
  if (message.length < 1 || message.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, field: "message" };
  }
  if (!isValidFeedbackPath(raw.path)) return { ok: false, field: "path" };
  return {
    ok: true,
    value: { category: raw.category, message, path: normalizeFeedbackPath(raw.path) },
  };
}

/** Tope diario: `sentLast24h` son los envíos de la persona en las últimas 24 h (contados en la base). */
export function isOverDailyLimit(sentLast24h: number): boolean {
  return sentLast24h >= FEEDBACK_DAILY_LIMIT;
}
