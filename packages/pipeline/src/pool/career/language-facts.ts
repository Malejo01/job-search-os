import { detectJobLanguage, type DetectedJobLanguage } from "../../normalize/language";
import { detectEnglish } from "./english";
import type { EnglishLevel } from "./types";

/**
 * Idioma y nivel de inglés de un aviso del pool, calculados una sola vez (C8-15, auditoría de Neon,
 * propuesta 1). Se guardan en `public_jobs` al ingerir (y con el relleno para lo existente), así el
 * mercado por carrera no vuelve a leer el texto del aviso. Mismo resultado que llamar a
 * `detectJobLanguage` y `detectEnglish` sobre el texto: un test lo verifica.
 */
export type JobLanguageFacts = {
  jdLanguage: DetectedJobLanguage | null;
  englishLanguage: "en" | "es" | null;
  englishAsks: boolean;
  englishLevel: EnglishLevel | null;
};

export function jobLanguageFacts(jdText: string | null, lang: string | null): JobLanguageFacts {
  const en = detectEnglish(jdText, lang);
  return {
    jdLanguage: detectJobLanguage(jdText, lang),
    englishLanguage: en.language,
    englishAsks: en.asks,
    englishLevel: en.level,
  };
}
