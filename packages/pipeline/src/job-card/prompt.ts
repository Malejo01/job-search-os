import { neutralizeDelimiters } from "../interview/input";

/**
 * Variables del prompt `extract_job_card` (R31-02). El texto del aviso viene de afuera: va en un bloque delimitado
 * como dato, sin caracteres invisibles y sin poder cerrar el bloque. Solo viaja el texto: la ficha es función del
 * texto (ADR-048), así que ni el título ni la empresa ni nada de la persona entran al prompt.
 *
 * El texto que viaja es el MISMO contra el que se verifican las citas (`prepareJobCardText`): el worker verifica
 * contra el valor que devuelve esta función, no contra el original.
 */
export const JOB_CARD_TEXT_MAX_CHARS = 12_000;

// Control (salvo \n y \t), invisibles de ancho cero y de dirección; armado con una cadena para no escribirlos.
/* eslint-disable no-control-regex */
const INVISIBLE_RE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]",
  "g",
);
/* eslint-enable no-control-regex */

/** Texto del aviso listo para el modelo y para verificar. Se recorta antes de limpiar. */
export function prepareJobCardText(text: string): string {
  return neutralizeDelimiters(
    text
      .slice(0, JOB_CARD_TEXT_MAX_CHARS * 2)
      .replace(INVISIBLE_RE, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  ).slice(0, JOB_CARD_TEXT_MAX_CHARS);
}

export function buildJobCardPromptVars(description: string): {
  vars: { job: string };
  text: string;
} {
  const text = prepareJobCardText(description);
  return {
    vars: {
      job: ["<<<AVISO>>>", text === "" ? "(sin texto)" : text, "<<<FIN AVISO>>>"].join("\n"),
    },
    text,
  };
}
