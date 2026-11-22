import { err, ok, type Result } from "../result";

/**
 * Respuesta de la persona antes de mandarla al modelo. Es un dato, no una instrucción: acá solo se limpia
 * (invisibles, saltos de línea, delimitadores) y se acota el tamaño. Sin I/O.
 */
export const INTERVIEW_ANSWER_MIN_CHARS = 20;
export const INTERVIEW_ANSWER_MAX_CHARS = 1500;

export type InterviewAnswerError = "empty" | "too_short";

// Control (salvo \n y \t), invisibles de ancho cero y de dirección. Se arma con una cadena para que el archivo
// no lleve caracteres invisibles a la vista.
/* eslint-disable no-control-regex */
const INVISIBLE_RE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]",
  "g",
);
/* eslint-enable no-control-regex */

/** `<<<` y `>>>` de la persona no pueden cerrar ni abrir el bloque que arma el código. */
export const neutralizeDelimiters = (text: string): string =>
  text.replace(/<{3,}/g, "‹‹‹").replace(/>{3,}/g, "›››");

export function prepareInterviewAnswer(
  raw: string,
): Result<{ text: string; truncated: boolean }, InterviewAnswerError> {
  const cleaned = neutralizeDelimiters(
    raw
      .replace(INVISIBLE_RE, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
  if (cleaned === "") return err("empty");
  if (cleaned.length < INTERVIEW_ANSWER_MIN_CHARS) return err("too_short");
  if (cleaned.length <= INTERVIEW_ANSWER_MAX_CHARS) return ok({ text: cleaned, truncated: false });
  let head = cleaned.slice(0, INTERVIEW_ANSWER_MAX_CHARS);
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return ok({ text: head.trimEnd(), truncated: true });
}
