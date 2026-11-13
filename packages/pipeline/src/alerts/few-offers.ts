/**
 * «Pocas ofertas en tu idioma» (R11-10). Puro: recibe el volumen de los últimos 7 días por carrera
 * (`CareerMarket.volume.last7d`) y el idioma que acepta la persona; dice en qué carreras hay menos
 * de `FEW_OFFERS_THRESHOLD` avisos. La pantalla decide qué hacer con eso (cargar ofertas, alertas).
 */
import type { AlertLanguage } from "./portal-guide";

/** Con menos avisos que esto en la semana, la carrera se considera «con pocas ofertas». */
export const FEW_OFFERS_THRESHOLD = 5;

export type CareerVolume = {
  role: string;
  /** Ofertas nuevas en 7 días, en cualquier idioma. */
  total: number;
  /** De esas, las escritas en español. */
  writtenInSpanish: number;
};

/** Ofertas de la carrera en el idioma de la persona; «en inglés» = las que no están en español. */
export function offersInLanguage(volume: CareerVolume, language: AlertLanguage): number {
  if (language === "es") return volume.writtenInSpanish;
  if (language === "en") return Math.max(0, volume.total - volume.writtenInSpanish);
  return volume.total;
}

/** Las carreras con menos de `FEW_OFFERS_THRESHOLD` ofertas en ese idioma, en el orden recibido. */
export function careersWithFewOffers(
  volumes: readonly CareerVolume[],
  language: AlertLanguage,
): { role: string; count: number }[] {
  return volumes
    .map((v) => ({ role: v.role, count: offersInLanguage(v, language) }))
    .filter((c) => c.count < FEW_OFFERS_THRESHOLD);
}

export function languageNoun(language: AlertLanguage): string {
  return language === "es" ? "español" : language === "en" ? "inglés" : "español e inglés";
}
