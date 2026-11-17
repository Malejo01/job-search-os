/**
 * Tipos de problema del diagnóstico y su orden (ADR-038 §4). El modelo propone problemas con estos tipos;
 * el orden, el recorte y el texto que ve la persona los decide el código. Puro.
 */

export const CV_ISSUE_TYPES = [
  "logro_sin_resultado",
  "tarea_vaga",
  "vineta_sin_verbo",
  "skill_pedida_sin_evidencia",
  "proyecto_sin_stack_o_link",
  "brecha_con_puesto",
  "fecha_faltante",
  "inconsistencia",
  "resumen_generico",
  "orden_poco_relevante",
] as const;
export type CvIssueType = (typeof CV_ISSUE_TYPES)[number];

export const CV_ISSUE_SEVERITIES = ["alta", "media", "baja"] as const;
export type CvIssueSeverity = (typeof CV_ISSUE_SEVERITIES)[number];

/** Prioridad fija por tipo, de mayor a menor (ADR-038 §4). Desempata después de la severidad. */
export const CV_ISSUE_PRIORITY: readonly CvIssueType[] = [
  "brecha_con_puesto",
  "skill_pedida_sin_evidencia",
  "logro_sin_resultado",
  "proyecto_sin_stack_o_link",
  "inconsistencia",
  "fecha_faltante",
  "tarea_vaga",
  "vineta_sin_verbo",
  "orden_poco_relevante",
  "resumen_generico",
];

/** Tipos que se calculan con datos del pool (`computeDemand`), no con la opinión del modelo. */
export const CV_ISSUE_DATA_TYPES: readonly CvIssueType[] = [
  "brecha_con_puesto",
  "skill_pedida_sin_evidencia",
];

/** Recorte de la lista por charla y por ítem del CV. */
export const CV_COACH_MAX_ISSUES = 10;
export const CV_COACH_MAX_ISSUES_PER_ITEM = 3;
/** Problemas que propone el modelo antes del recorte (lo que acepta el esquema de `cv_review`). */
export const CV_REVIEW_MAX_PROPOSED = 15;

/** Rango de un tipo en `CV_ISSUE_PRIORITY` (0 es el más prioritario). */
export function cvIssuePriority(type: CvIssueType): number {
  return CV_ISSUE_PRIORITY.indexOf(type);
}

/** Rango de una severidad (0 es «alta»). */
export function cvIssueSeverityRank(severity: CvIssueSeverity): number {
  return CV_ISSUE_SEVERITIES.indexOf(severity);
}
