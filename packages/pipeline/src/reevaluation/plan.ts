import { err, ok, type Result } from "../result";

/**
 * Reevaluación única de las ofertas abiertas con la versión nueva de `evaluate_job` (R31-09). Puro: decide qué
 * ofertas entran, cuánto cuesta y cuándo frenar; el I/O (base, modelo, archivo de estado) vive en
 * `packages/adapters/src/reevaluate`. No se corre en la tanda: lo corre el responsable con el prompt ya promovido.
 */

/** Una oferta con su última evaluación (la que muestra la pantalla). */
export type ReevaluationRow = {
  jobId: string;
  userId: string;
  status: string;
  /** `prompt_version` de la última evaluación; `null` si nunca se evaluó. */
  lastPromptVersion: string | null;
};

/** «Abiertas»: lo mismo que el requeue masivo (`REQUEUE_STATUSES.bulk`): solo `evaluada`. */
export const REEVALUATION_OPEN_STATUSES: readonly string[] = ["evaluada"];

export type ReevaluationSelection = {
  /** Lo que se reevalúa ahora, en el orden recibido. */
  todo: ReevaluationRow[];
  /** Ya tienen la versión nueva como última evaluación. */
  upToDate: ReevaluationRow[];
  /** La corrida ya las hizo (retomar). */
  alreadyDone: ReevaluationRow[];
  /** Cerradas, terminales o sin evaluación previa: no hay nada que comparar ni a qué volver. */
  notEligible: ReevaluationRow[];
  /** Entran pero quedan para otra tanda por el límite. */
  deferred: ReevaluationRow[];
};

export function selectReevaluationCandidates(
  rows: readonly ReevaluationRow[],
  options: { promptVersion: string; done: ReadonlySet<string>; limit?: number },
): ReevaluationSelection {
  const out: ReevaluationSelection = {
    todo: [],
    upToDate: [],
    alreadyDone: [],
    notEligible: [],
    deferred: [],
  };
  for (const r of rows) {
    if (options.done.has(r.jobId)) out.alreadyDone.push(r);
    else if (!REEVALUATION_OPEN_STATUSES.includes(r.status) || r.lastPromptVersion === null)
      out.notEligible.push(r);
    else if (r.lastPromptVersion === options.promptVersion) out.upToDate.push(r);
    else if (options.limit !== undefined && out.todo.length >= options.limit) out.deferred.push(r);
    else out.todo.push(r);
  }
  return out;
}

/**
 * Tokens que se suponen por evaluación con el prompt nuevo: la medición de la v1.x fue de unos 1.950 de entrada y
 * 430 de salida (docs/LLM_COSTOS.md); el prompt nuevo suma la ficha, así que se estima con un 50 % más.
 */
export const REEVALUATION_ESTIMATE_TOKENS = { input: 3000, output: 600 } as const;

/** USD por evaluación según el ruteo (`null` si no hay tarifa: no se inventa un costo). */
export function perCallReevaluationUsd(
  route: { inUsd: number | null; outUsd: number | null } | null,
): number | null {
  if (!route || route.inUsd === null || route.outUsd === null) return null;
  return (
    (REEVALUATION_ESTIMATE_TOKENS.input * route.inUsd +
      REEVALUATION_ESTIMATE_TOKENS.output * route.outUsd) /
    1e6
  );
}

export function estimateReevaluationUsd(count: number, perCallUsd: number | null): number | null {
  return perCallUsd === null ? null : count * perCallUsd;
}

export type ReevaluationNext = { ok: true } | { ok: false; reason: "cap" };

/**
 * ¿Se puede hacer la próxima? Frena si lo gastado más lo que se estima que cuesta pasa el tope. Sin estimado
 * conocido sigue mientras no se haya gastado todo el tope. Un número ilegible frena.
 */
export function decideNextReevaluation(input: {
  spentUsd: number;
  maxUsd: number;
  estimateUsd: number | null;
}): ReevaluationNext {
  const { spentUsd, maxUsd, estimateUsd } = input;
  if (!Number.isFinite(spentUsd) || !Number.isFinite(maxUsd)) return { ok: false, reason: "cap" };
  if (estimateUsd === null) return spentUsd < maxUsd ? { ok: true } : { ok: false, reason: "cap" };
  if (!Number.isFinite(estimateUsd)) return { ok: false, reason: "cap" };
  return spentUsd + estimateUsd <= maxUsd ? { ok: true } : { ok: false, reason: "cap" };
}

/** Tope de seguridad del propio tope: un cero de más no abre un gasto de cientos de dólares. */
export const REEVALUATION_MAX_USD_LIMIT = 50;

/** `--max-usd`: obligatorio, un número positivo y finito, hasta `REEVALUATION_MAX_USD_LIMIT`. */
export function parseReevaluationMaxUsd(
  raw: string | undefined,
): Result<number, "falta" | "invalido"> {
  const text = raw?.trim();
  if (text === undefined || text === "") return err("falta");
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || n > REEVALUATION_MAX_USD_LIMIT) return err("invalido");
  return ok(n);
}
