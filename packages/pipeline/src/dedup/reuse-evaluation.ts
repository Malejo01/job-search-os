/**
 * No reevaluar duplicados (R7-2). Puro: sin I/O ni reloj. Si a la misma persona le llega un aviso con el mismo
 * hash de descripción normalizada (`jobs.jd_hash`) que uno ya evaluado, y nada de lo que entra al modelo
 * cambió, se reutiliza la respuesta del modelo y no se vuelve a llamar. Ante la duda, se reevalúa:
 * preferimos gastar a mostrar una evaluación vieja.
 *
 * Qué entra al modelo (`buildEvaluateJobVars`): el aviso (texto y datos), el resumen y las restricciones del
 * perfil, los criterios y el prompt. Cuando se evalúa con el modelo, la evaluación guarda en
 * `decision.inputs` lo que se LEYÓ ANTES de la llamada (`ReuseInputs`). Reutilizar exige igualdad exacta con
 * lo de hoy:
 *   - JD: `inputs.jd_hash` igual al hash del aviso nuevo (no el hash actual del job previo, que la ingesta
 *     puede reescribir después de evaluar).
 *   - Perfil: `inputs.profile_updated_at` igual al `profiles.updated_at` de hoy (no una comparación de
 *     fechas contra la evaluación: una edición durante la llamada al modelo pasaría como vigente).
 *   - Criterios: misma `evaluation_criteria.version`.
 *   - Datos del aviso (título, empresa, ubicación, sueldo...): misma huella (`reuseJobFingerprint`).
 *   - Prompt: misma versión.
 * Las evaluaciones sin `inputs` (todas las anteriores a R7-2) no se reutilizan nunca.
 * El código (`decide()`, checklist, flags) se vuelve a correr siempre; solo se ahorra la llamada al modelo.
 */
import type { JobForPrompt } from "../evaluation";

/** Lo que leyó la evaluación antes de llamar al modelo; vive en `evaluations.decision.inputs`. */
export type ReuseInputs = {
  jdHash: string;
  /** `profiles.updated_at` en ISO. */
  profileUpdatedAt: string;
  criteriaVersion: number;
  jobFingerprint: string;
};

export type ReusePrev = {
  /** null = evaluación sin `inputs`: no se reutiliza. */
  inputs: ReuseInputs | null;
  promptVersion: string;
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
        | "sin_inputs"
        | "sin_hash"
        | "jd_distinta"
        | "prompt_distinto"
        | "criterios_cambiaron"
        | "aviso_distinto"
        | "fecha_invalida"
        | "perfil_cambio";
    };

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/** Forma en `decision.inputs` (jsonb, snake_case). */
export function reuseInputsToJson(i: ReuseInputs): Record<string, unknown> {
  return {
    jd_hash: i.jdHash,
    profile_updated_at: i.profileUpdatedAt,
    criteria_version: i.criteriaVersion,
    job_fingerprint: i.jobFingerprint,
  };
}

/** Lee `decision.inputs`. Cualquier forma inesperada devuelve null (no se reutiliza). */
export function parseReuseInputs(decision: unknown): ReuseInputs | null {
  if (typeof decision !== "object" || decision === null) return null;
  const raw = (decision as Record<string, unknown>).inputs;
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.jd_hash !== "string" ||
    r.jd_hash === "" ||
    typeof r.profile_updated_at !== "string" ||
    typeof r.criteria_version !== "number" ||
    !Number.isInteger(r.criteria_version) ||
    typeof r.job_fingerprint !== "string"
  ) {
    return null;
  }
  return {
    jdHash: r.jd_hash,
    profileUpdatedAt: r.profile_updated_at,
    criteriaVersion: r.criteria_version,
    jobFingerprint: r.job_fingerprint,
  };
}

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
  const inputs = prev.inputs;
  if (!inputs) return { reuse: false, reason: "sin_inputs" };
  if (!inputs.jdHash || !current.jdHash) return { reuse: false, reason: "sin_hash" };
  if (inputs.jdHash !== current.jdHash) return { reuse: false, reason: "jd_distinta" };
  if (prev.promptVersion !== current.promptVersion) {
    return { reuse: false, reason: "prompt_distinto" };
  }
  if (inputs.criteriaVersion !== current.criteriaVersion) {
    return { reuse: false, reason: "criterios_cambiaron" };
  }
  if (inputs.jobFingerprint !== current.jobFingerprint) {
    return { reuse: false, reason: "aviso_distinto" };
  }
  const now = current.profileUpdatedAt.getTime();
  const then = new Date(inputs.profileUpdatedAt).getTime();
  if (Number.isNaN(now) || Number.isNaN(then)) return { reuse: false, reason: "fecha_invalida" };
  // Igualdad exacta: cualquier edición del perfil, antes, durante o después de la llamada, lo mueve
  if (now !== then) return { reuse: false, reason: "perfil_cambio" };
  return { reuse: true };
}
