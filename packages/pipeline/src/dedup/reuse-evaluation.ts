/**
 * No reevaluar duplicados (R7-2). Puro: sin I/O ni reloj. Si a la misma persona le llega un aviso con el mismo
 * hash de descripción normalizada (`jobs.jd_hash`) que uno ya evaluado, y nada de lo que entra al modelo
 * cambió desde esa evaluación, se reutiliza la respuesta del modelo y no se vuelve a llamar. Ante la duda, se
 * reevalúa: preferimos gastar a mostrar una evaluación vieja.
 *
 * Qué entra al modelo (`buildEvaluateJobVars`): el aviso (texto y datos), el resumen y las restricciones del
 * perfil, los criterios y el prompt. Se compara cada cosa:
 *   - JD: mismo hash.
 *   - Datos del aviso (título, empresa, ubicación, sueldo...): misma huella (`reuseJobFingerprint`).
 *   - Perfil: `profiles.updated_at` anterior a la evaluación previa (toda escritura del perfil lo mueve).
 *   - Criterios: misma `evaluation_criteria.version`.
 *   - Prompt: misma versión.
 * El código (`decide()`, checklist, flags) se vuelve a correr siempre; solo se ahorra la llamada al modelo.
 */
import type { JobForPrompt } from "../evaluation";

export type ReusePrev = {
  jdHash: string | null;
  promptVersion: string;
  criteriaVersion: number;
  /** `evaluations.created_at` de la evaluación previa. */
  evaluatedAt: Date;
  hadFullJd: boolean;
  jobFingerprint: string;
};

export type ReuseCurrent = {
  jdHash: string | null;
  promptVersion: string;
  criteriaVersion: number;
  /** `profiles.updated_at` hoy. */
  profileUpdatedAt: Date;
  jobFingerprint: string;
};

export type ReuseDecision =
  | { reuse: true }
  | {
      reuse: false;
      reason:
        | "sin_hash"
        | "jd_distinta"
        | "previa_sin_jd"
        | "prompt_distinto"
        | "criterios_cambiaron"
        | "aviso_distinto"
        | "fecha_invalida"
        | "perfil_cambio";
    };

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/**
 * Huella de los datos del aviso que entran al prompt, sin el texto de la JD (eso lo cubre el hash). Estable
 * ante espacios sobrantes y orden de países; `null` y vacío valen lo mismo, salvo `countriesAllowed`, donde
 * `null` es «desconocido» y una lista vacía no.
 */
export function reuseJobFingerprint(job: JobForPrompt): string {
  const posted =
    job.postedAt === null || job.postedAt === undefined ? "" : new Date(job.postedAt).toISOString();
  return JSON.stringify([
    clean(job.title),
    clean(job.companyRaw),
    clean(job.locationRaw),
    job.countriesAllowed ? [...job.countriesAllowed].map(clean).sort() : null,
    clean(job.modality),
    clean(job.contractType),
    job.salaryMinUsd ?? null,
    job.salaryMaxUsd ?? null,
    clean(job.salaryPeriod),
    clean(job.salaryNote),
    job.weeklyHours ?? null,
    job.candidatesCount ?? null,
    job.badges ? [...job.badges].map(clean) : null,
    posted,
    clean(job.matchedRole),
  ]);
}

export function shouldReuseEvaluation(input: {
  prev: ReusePrev;
  current: ReuseCurrent;
}): ReuseDecision {
  const { prev, current } = input;
  if (!prev.jdHash || !current.jdHash) return { reuse: false, reason: "sin_hash" };
  if (prev.jdHash !== current.jdHash) return { reuse: false, reason: "jd_distinta" };
  if (!prev.hadFullJd) return { reuse: false, reason: "previa_sin_jd" };
  if (prev.promptVersion !== current.promptVersion) {
    return { reuse: false, reason: "prompt_distinto" };
  }
  if (prev.criteriaVersion !== current.criteriaVersion) {
    return { reuse: false, reason: "criterios_cambiaron" };
  }
  if (prev.jobFingerprint !== current.jobFingerprint) {
    return { reuse: false, reason: "aviso_distinto" };
  }
  const evaluated = prev.evaluatedAt.getTime();
  const profile = current.profileUpdatedAt.getTime();
  if (Number.isNaN(evaluated) || Number.isNaN(profile)) {
    return { reuse: false, reason: "fecha_invalida" };
  }
  // El perfil tiene que ser estrictamente anterior: en el mismo instante no se puede asegurar el orden
  if (profile >= evaluated) return { reuse: false, reason: "perfil_cambio" };
  return { reuse: true };
}
