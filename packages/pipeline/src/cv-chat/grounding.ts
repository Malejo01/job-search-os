/**
 * Controles sobre lo que devuelve el modelo en la entrevista (C-25, vuelta 2 de seguridad). Puros.
 * - `extractionGrounded` (S-5): los números, nombres propios y tecnologías de lo extraído tienen que estar
 *   en el mensaje de la persona; si no, la extracción se descarta y el tema cuenta como falla.
 * - `safeCvAck` (S-4): el acuse es texto libre del modelo; con dígitos se reemplaza por uno fijo.
 */
import { cleanCvText, cvRejectReasons, foldCvText } from "../cv-out/verify";

export const CV_FIXED_ACK = "Perfecto, lo anoto.";

const URL_KEYS = new Set(["linkedin", "github", "portfolio"]);
// Meses, banderas y confirmaciones no son texto de la persona
const EXEMPT_KEYS = new Set(["startMonth", "endMonth", "isCurrent", "more", "noExperience"]);
const CHECKED = new Set([
  "number_not_in_answers",
  "name_not_in_answers",
  "technology_not_in_answers",
]);

function leaves(value: unknown, key: string, out: { key: string; text: string }[]): void {
  if (typeof value === "string") out.push({ key, text: value });
  else if (Array.isArray(value)) for (const v of value) leaves(v, key, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) leaves(v, k, out);
  }
}

/** ¿Todo lo que trae la extracción está en el mensaje? Conservador: ante la duda, no. */
export function extractionGrounded(extraction: unknown, message: string): boolean {
  const found: { key: string; text: string }[] = [];
  leaves(extraction, "", found);
  const folded = foldCvText(message);
  for (const { key, text } of found) {
    if (EXEMPT_KEYS.has(key)) continue;
    if (URL_KEYS.has(key)) {
      if (!folded.includes(foldCvText(text))) return false;
      continue;
    }
    if (cvRejectReasons(text, [message], { maxChars: 10_000 }).some((r) => CHECKED.has(r))) {
      return false;
    }
  }
  return true;
}

/** Acuse corto y seguro: sin dígitos, sin links; si no pasa, el fijo. */
export function safeCvAck(ack: string | null | undefined): string {
  const clean = cleanCvText(ack ?? "", 160);
  return clean === "" || /\d/.test(clean) ? CV_FIXED_ACK : clean;
}
