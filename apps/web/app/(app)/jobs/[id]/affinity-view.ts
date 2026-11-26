import type { AffinityItem, AffinityKey } from "@job-search-os/pipeline";
import { formatScoreNumber } from "../../../../lib/labels";
import { AFFINITY_WORDS, ESTADO_REQUISITO_TEXTOS } from "../../../../lib/textos-rediseno";

export const AFFINITY_CRITERIA: Record<AffinityKey, string> = {
  role_skills: "Rol y habilidades",
  seniority: "Seniority",
  location: "Ubicación y modalidad",
  language: "Idioma",
  salary: "Sueldo",
};

export type AffinityRow = {
  key: AffinityKey;
  label: string;
  /** «7,5» o null si no hay datos. */
  scoreText: string | null;
  /** Palabra del nivel, o «Sin confirmar» (el criterio no tiene dato). */
  word: string;
  /** Ancho de la barra, 0 a 100. */
  percent: number;
};

/** Pasa los criterios de la función pura a lo que se dibuja: coma decimal y palabras de `textos-rediseno`. */
export function affinityRows(items: readonly AffinityItem[]): AffinityRow[] {
  return items.map((i) => ({
    key: i.key,
    label: AFFINITY_CRITERIA[i.key],
    scoreText: i.score === null ? null : formatScoreNumber(i.score),
    word: i.level === null ? ESTADO_REQUISITO_TEXTOS.sinConfirmar : AFFINITY_WORDS[i.level],
    percent: i.score === null ? 0 : Math.round(i.score * 10),
  }));
}
