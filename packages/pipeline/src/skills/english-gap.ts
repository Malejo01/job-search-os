import { foldText } from "../normalize/text";
import { detectEnglish } from "../pool/career/english";
import { ENGLISH_SKILL_SLUGS } from "./english";

/**
 * `true` solo si el aviso está en español y no pide inglés: ahí el inglés no puede ser una brecha.
 * Ante duda (idioma desconocido, sin texto) devuelve `false`: no se oculta nada. Puro.
 */
export function englishIsNotAGap(jdText: string | null, lang: string | null): boolean {
  if (!jdText || !jdText.trim()) return false;
  const found = detectEnglish(jdText, lang);
  return found.language === "es" && !found.asks;
}

const ENGLISH_WORD = /(^|[^a-z])(ingles|english)([^a-z]|$)/;

/**
 * `true` si un gap del modelo (texto libre: "Inglés avanzado", "english C1") o un slug de la
 * taxonomía (`english_fluent`) habla del inglés.
 */
export function isEnglishGap(skill: string): boolean {
  const folded = foldText(skill).trim();
  if (!folded) return false;
  if ((ENGLISH_SKILL_SLUGS as readonly string[]).includes(folded)) return true;
  return ENGLISH_WORD.test(folded);
}
