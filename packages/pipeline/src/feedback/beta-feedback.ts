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
export const FEEDBACK_CONTEXT_MAX_BYTES = 4096;
export const FEEDBACK_ACTIONS_MAX = 10;
export const FEEDBACK_ACTION_TEXT_MAX = 60;
/** Envíos por persona en una ventana de 24 h. */
export const FEEDBACK_DAILY_LIMIT = 10;

export type FeedbackAction = {
  type: "navigate" | "click";
  text: string;
  time: string;
};

export type FeedbackContext = {
  pathname?: string;
  pageTitle?: string;
  screen?: string;
  userAgent?: string;
  theme?: "dark" | "light" | string;
  appVersion?: string | null;
  actions?: FeedbackAction[];
};

export type FeedbackField = "category" | "message" | "path" | "context" | "limit";

export type FeedbackInput = {
  category: FeedbackCategory;
  message: string;
  path: string;
  context?: FeedbackContext | null;
};

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

/**
 * Agrega una acción al buffer en memoria respetando el tope de 10 elementos (FIFO)
 * y truncando el texto a 60 caracteres.
 */
export function pushAction(
  buffer: readonly FeedbackAction[],
  action: { type: "navigate" | "click"; text: string; time?: string },
): FeedbackAction[] {
  const cleanText = action.text.trim().replace(/\s+/g, " ").slice(0, FEEDBACK_ACTION_TEXT_MAX);
  if (!cleanText) return [...buffer];
  const item: FeedbackAction = {
    type: action.type,
    text: cleanText,
    time: action.time ?? new Date().toISOString(),
  };
  const next = [...buffer, item];
  if (next.length > FEEDBACK_ACTIONS_MAX) {
    return next.slice(next.length - FEEDBACK_ACTIONS_MAX);
  }
  return next;
}

/** Un texto de clic más largo que esto es contenido (un título, un asunto), no una etiqueta de la interfaz. */
export const FEEDBACK_CLICK_LABEL_MAX = 40;

/**
 * Limpia el texto de un clic antes de anotarlo (C5-5): `null` si trae un email; direcciones web y números
 * de 6 o más cifras (teléfonos, documentos, ids) se reemplazan por «#».
 */
export function scrubClickText(text: string): string | null {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean || clean.includes("@")) return null;
  return clean.replace(/https?:\/\/\S+/gi, "#").replace(/\d{6,}/g, "#");
}

const DETAIL_LABELS: Record<string, string> = {
  jobs: "Abrir el detalle de una oferta",
  inbox: "Abrir el detalle de un email",
  applications: "Abrir el detalle de una postulación",
};
/** Pantallas fijas colgadas de esas secciones: su texto es de la interfaz y se conserva. */
const FIXED_SUBPAGES = new Set(["new", "pending-jd"]);

/**
 * Qué se anota de un clic en un botón o link (C5-5). Los links al detalle de una oferta, un email o una
 * postulación envuelven la tarjeta entera (título, empresa, asunto de un email de un tercero): no se anota
 * ese texto sino «Abrir el detalle de …». Un texto largo se toma por contenido y tampoco se anota.
 * Sin esto, el contexto del reporte de soporte podría llevar datos de avisos o de terceros. Puro.
 */
export function feedbackClickLabel(input: {
  ariaLabel?: string | null | undefined;
  text: string;
  href?: string | null | undefined;
}): string | null {
  const detail = /^\/(jobs|inbox|applications)\/([^/?#]+)/.exec(input.href ?? "");
  if (detail && !FIXED_SUBPAGES.has(detail[2]!)) return DETAIL_LABELS[detail[1]!] ?? null;
  const scrubbed = scrubClickText(input.ariaLabel?.trim() || input.text);
  if (scrubbed === null) return null;
  if (scrubbed.length > FEEDBACK_CLICK_LABEL_MAX) return "(texto largo omitido)";
  return scrubbed;
}

export type FeedbackContextValidation =
  { ok: true; value: FeedbackContext | null } | { ok: false; reason: string };

/**
 * Valida el contexto del reporte de feedback (puro).
 * Verifica que el tamaño serializado sea <= 4 KB (4096 bytes),
 * que no exceda 10 acciones, y que los textos no superen 60 caracteres.
 */
export function validateFeedbackContext(raw: unknown): FeedbackContextValidation {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null };
  }
  let obj: unknown = raw;
  let rawString: string;
  if (typeof raw === "string") {
    rawString = raw;
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  } else {
    try {
      rawString = JSON.stringify(raw);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  }

  if (new TextEncoder().encode(rawString).length > FEEDBACK_CONTEXT_MAX_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, reason: "not_an_object" };
  }
  const rec = obj as Record<string, unknown>;
  const actionsRaw = Array.isArray(rec.actions) ? rec.actions : [];
  if (actionsRaw.length > FEEDBACK_ACTIONS_MAX) {
    return { ok: false, reason: "too_many_actions" };
  }
  const actions: FeedbackAction[] = [];
  for (const a of actionsRaw) {
    if (typeof a !== "object" || a === null) continue;
    const aRec = a as Record<string, unknown>;
    const type = aRec.type === "click" || aRec.type === "navigate" ? aRec.type : "click";
    const rawText = typeof aRec.text === "string" ? aRec.text : "";
    // Defensa en profundidad (C5-5): los clics se vuelven a limpiar acá; las pantallas (navigate) son rutas
    const cleaned = type === "click" ? scrubClickText(rawText) : rawText;
    const text = (cleaned ?? "").trim().replace(/\s+/g, " ").slice(0, FEEDBACK_ACTION_TEXT_MAX);
    if (!text) continue;
    const time = typeof aRec.time === "string" ? aRec.time.slice(0, 30) : new Date().toISOString();
    actions.push({ type, text, time });
  }

  let pathname: string | undefined;
  if (typeof rec.pathname === "string") {
    pathname = rec.pathname.split(/[?#]/)[0]?.slice(0, FEEDBACK_PATH_MAX);
  }

  const pageTitle = typeof rec.pageTitle === "string" ? rec.pageTitle.slice(0, 100) : undefined;
  const screen = typeof rec.screen === "string" ? rec.screen.slice(0, 30) : undefined;
  const userAgent = typeof rec.userAgent === "string" ? rec.userAgent.slice(0, 200) : undefined;
  const theme = rec.theme === "dark" || rec.theme === "light" ? rec.theme : undefined;
  const appVersion = typeof rec.appVersion === "string" ? rec.appVersion.slice(0, 50) : null;

  const sanitized: FeedbackContext = {
    pathname,
    pageTitle,
    screen,
    userAgent,
    theme,
    appVersion,
    actions,
  };

  const serialized = JSON.stringify(sanitized);
  if (new TextEncoder().encode(serialized).length > FEEDBACK_CONTEXT_MAX_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  return {
    ok: true,
    value: sanitized,
  };
}

export type FeedbackValidation =
  | { ok: true; value: FeedbackInput }
  | { ok: false; field: Exclude<FeedbackField, "limit" | "context"> };

/** Valida los campos en orden; devuelve el primero inválido, nunca su contenido. */
export function validateFeedback(raw: {
  category: unknown;
  message: unknown;
  path: unknown;
  context?: unknown;
}): FeedbackValidation {
  if (!isFeedbackCategory(raw.category)) return { ok: false, field: "category" };
  if (typeof raw.message !== "string") return { ok: false, field: "message" };
  const message = normalizeFeedbackMessage(raw.message);
  if (message.length < 1 || message.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, field: "message" };
  }
  if (!isValidFeedbackPath(raw.path)) return { ok: false, field: "path" };

  let context: FeedbackContext | null = null;
  if (raw.context !== undefined && raw.context !== null && raw.context !== "") {
    const ctxVal = validateFeedbackContext(raw.context);
    // El contexto técnico es accesorio: si excede el tamaño o es inválido,
    // se descarta suavemente (context = null) para nunca perder el mensaje del usuario.
    context = ctxVal.ok ? ctxVal.value : null;
  }

  return {
    ok: true,
    value: {
      category: raw.category,
      message,
      path: normalizeFeedbackPath(raw.path),
      context,
    },
  };
}

/** Tope diario: `sentLast24h` son los envíos de la persona en las últimas 24 h (contados en la base). */
export function isOverDailyLimit(sentLast24h: number): boolean {
  return sentLast24h >= FEEDBACK_DAILY_LIMIT;
}
