import { err, ok, type Result } from "../result";
import { CV_MAX_TEXT_CHARS, CV_MIN_TEXT_CHARS } from "./limits";

export type CvTextError = "too_short" | "too_long";

/** Controles salvo \n y \t, invisibles (ancho cero, guion blando, BOM, bidi) y caracteres de etiqueta. */
const STRIP_RE = new RegExp(
  "[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u00ad\\u200b-\\u200f\\u202a-\\u202e" +
    "\\u2060-\\u2064\\u2066-\\u2069\\ufeff]|[\\u{e0000}-\\u{e007f}]",
  "gu",
);

/** NFC, sin controles ni invisibles, espacios colapsados, como mucho 2 \n seguidos. */
export function normalizeCvText(text: string): Result<string, CvTextError> {
  const clean = text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(STRIP_RE, "")
    .replace(/[^\S\n\t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length < CV_MIN_TEXT_CHARS) return err("too_short");
  if (clean.length > CV_MAX_TEXT_CHARS) return err("too_long");
  return ok(clean);
}
