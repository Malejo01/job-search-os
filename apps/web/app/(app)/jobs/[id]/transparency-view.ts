import type { TransparencyKey, TransparencyResult } from "@job-search-os/pipeline";
import { formatScoreNumber } from "../../../../lib/labels";
import { TRANSPARENCY_WORDS } from "../../../../lib/textos-rediseno";

export const MISSING_LABELS: Record<TransparencyKey, string> = {
  salary: "El sueldo",
  modality: "La modalidad de trabajo",
  company: "El nombre de la empresa",
  seniority: "El nivel de seniority o los años pedidos",
  location: "La ubicación",
  tasks: "Las tareas concretas del puesto",
  requirements: "Los requisitos",
};

export type TransparencyView = {
  /** «7,5» (con coma). */
  scoreText: string;
  word: string;
  missing: string[];
};

/** Lo que se dibuja de la transparencia: coma decimal, palabra de `textos-rediseno` y faltantes en llano. */
export function transparencyView(result: TransparencyResult): TransparencyView {
  return {
    scoreText: formatScoreNumber(result.score),
    word: TRANSPARENCY_WORDS[result.level],
    missing: result.missing.map((k) => MISSING_LABELS[k]),
  };
}
