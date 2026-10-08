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
