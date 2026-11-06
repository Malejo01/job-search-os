/**
 * Completa los marcadores de datos legales de los textos (JS-120): puro, sin I/O. Recibe el
 * Markdown y un objeto con las variables (`process.env` lo pasa quien llama). Si falta un valor,
 * el marcador se reemplaza por un texto "en revisión": nunca queda un marcador entre corchetes.
 */

export type LegalEnv = Partial<
  Record<"LEGAL_RESPONSABLE" | "LEGAL_DOMICILIO" | "LEGAL_EMAIL" | "LEGAL_LOG_DAYS", string>
>;

export const LEGAL_PENDING_TEXT = "(dato en revisión)";

const LOG_MARKER = "[A DEFINIR: plazo de retención de los logs]";
const LOG_PENDING_TEXT = "un plazo que está en revisión";

const MAX_VALUE_LENGTH = 200;

/** Escapa lo que el parser de markdown.ts interpreta, para que el valor se lea como texto. */
function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*[\]()|]/g, "\\$&");
}

function textValue(raw: string | undefined): string | null {
  if (!raw) return null;
  // Los caracteres de formato invisibles (\p{Cf}: ancho cero, bidi) se quitan; los de control pasan a espacio.
  const clean = raw
    .replace(/\p{Cf}/gu, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  if (!clean || clean.length > MAX_VALUE_LENGTH) return null;
  return escapeMarkdown(clean);
}

function daysValue(raw: string | undefined): string | null {
  const t = raw?.trim();
  if (!t || !/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  if (n < 1 || n > 3650) return null;
  return `${n} ${n === 1 ? "día" : "días"}`;
}

const PLACEHOLDERS =
  /\[RESPONSABLE\]|\[DOMICILIO\]|\[EMAIL DE CONTACTO\]|\[A DEFINIR: plazo de retención de los logs\]/g;

export function fillLegalPlaceholders(markdown: string, env: LegalEnv): string {
  const values: Record<string, string | null> = {
    "[RESPONSABLE]": textValue(env.LEGAL_RESPONSABLE),
    "[DOMICILIO]": textValue(env.LEGAL_DOMICILIO),
    "[EMAIL DE CONTACTO]": textValue(env.LEGAL_EMAIL),
    "[A DEFINIR: plazo de retención de los logs]": daysValue(env.LEGAL_LOG_DAYS),
  };
  // Una sola pasada: un valor que contenga otro marcador no se vuelve a reemplazar.
  return markdown.replace(
    PLACEHOLDERS,
    (m) => values[m] ?? (m === LOG_MARKER ? LOG_PENDING_TEXT : LEGAL_PENDING_TEXT),
  );
}

const ENV_KEY: Record<string, keyof LegalEnv> = {
  "[RESPONSABLE]": "LEGAL_RESPONSABLE",
  "[DOMICILIO]": "LEGAL_DOMICILIO",
  "[EMAIL DE CONTACTO]": "LEGAL_EMAIL",
  [LOG_MARKER]: "LEGAL_LOG_DAYS",
};

/** Marcas que un texto vigente no puede tener (decisiones pendientes y notas de revisión). */
const DRAFT_MARKS =
  /\{\{MAURO:|\[(?:A REVISAR|A CONFIRMAR|CONFIRMAR|CONSULTAR|A DEFINIR|REVISAR CON)\b/;

/**
 * true si el texto todavía no puede mostrarse como vigente: falta o es inválida alguna variable
 * LEGAL_* que el texto usa, o queda una marca de borrador. Recibe el Markdown SIN completar.
 */
export function legalTextIsDraft(markdown: string, env: LegalEnv): boolean {
  for (const m of new Set(markdown.match(PLACEHOLDERS) ?? [])) {
    const key = ENV_KEY[m]!;
    const value = m === LOG_MARKER ? daysValue(env[key]) : textValue(env[key]);
    if (value === null) return true;
  }
  // El marcador de los logs empieza con "[A DEFINIR": se quita antes de buscar marcas
  return DRAFT_MARKS.test(markdown.replace(PLACEHOLDERS, ""));
}

export type LegalMissing = {
  /** El marcador tal cual, o el comienzo de la marca de borrador (`[A DEFINIR`, `{{MAURO:`…). */
  marker: string;
  /** Línea del Markdown (desde 1). */
  line: number;
  /** Variable que lo completa; null si hay que reescribir el texto (marca de borrador). */
  envKey: keyof LegalEnv | null;
};

const DRAFT_MARKS_GLOBAL =
  /\{\{MAURO:|\[(?:A REVISAR|A CONFIRMAR|CONFIRMAR|CONSULTAR|A DEFINIR|REVISAR CON)\b/g;

/**
 * Lo que impide dar el texto por vigente (C8-12, `pnpm legal:check`): cada marcador sin variable válida
 * y cada marca de borrador, con su línea. Mismas reglas que `legalTextIsDraft`: vacío ⇔ vigente.
 */
export function legalMissing(markdown: string, env: LegalEnv): LegalMissing[] {
  const out: LegalMissing[] = [];
  markdown.split("\n").forEach((text, i) => {
    for (const m of text.match(PLACEHOLDERS) ?? []) {
      const key = ENV_KEY[m]!;
      const value = m === LOG_MARKER ? daysValue(env[key]) : textValue(env[key]);
      if (value === null) out.push({ marker: m, line: i + 1, envKey: key });
    }
    for (const m of text.replace(PLACEHOLDERS, "").match(DRAFT_MARKS_GLOBAL) ?? []) {
      out.push({ marker: m, line: i + 1, envKey: null });
    }
  });
  return out;
}
