import { err, ok, type Result } from "../result";
import type { JobStatus } from "../status";

/**
 * Fusión manual de un `posible_duplicado` (JS-025, ADR-013). Desde ADR-013, empresa + título
 * parecido no fusiona: marca el job nuevo con `duplicate_of_id` y el flag. Acá la persona
 * confirma que son el mismo aviso y esta regla decide cómo fusionarlos, con las mismas reglas
 * que la fusión automática (fecha más antigua, texto más largo, flags acumulados).
 *
 * Cuál queda:
 * - El que tiene historia propia (evaluación o postulación), para no perderla.
 * - Si ninguno tiene, el original (al que apunta la marca): es el más viejo y el que ya se vio.
 * - Si los dos tienen, no se fusiona: se perdería una evaluación o una postulación. Queda a la
 *   persona decidir (descartar uno, o "no son la misma").
 *
 * Las fuentes del absorbido pasan al que queda con su crudo (JS-024), así que ningún JD se pierde
 * aunque el texto que quede en `jobs.jd_text` sea el del otro.
 */
export type DuplicateCandidate = {
  id: string;
  duplicateOfId: string | null;
  status: JobStatus;
  /** Largo del JD; 0 si no tiene. */
  jdLength: number;
  firstSeenAt: Date;
  flags: readonly string[];
  canonicalUrl: string | null;
  /** Tiene evaluación o postulación. */
  hasHistory: boolean;
};

export type DuplicateMergePlan = {
  survivorId: string;
  absorbedId: string;
  /** El JD del absorbido es más largo: pasa al que queda (con hash, shingles y skills). */
  takeJdFromAbsorbed: boolean;
  firstSeenAt: Date;
  /** Unión de los dos, sin `posible_duplicado`. */
  flags: string[];
  canonicalUrl: string | null;
  /** El que queda esperaba JD y la recibe: va a evaluación. */
  enqueueEvaluation: boolean;
};

export type DuplicateMergeError = "not_a_duplicate_pair" | "both_have_history";

export const POSSIBLE_DUPLICATE_FLAG = "posible_duplicado";

/**
 * @param flagged el job con la marca `posible_duplicado`
 * @param target el job al que apunta `flagged.duplicateOfId`
 */
export function planDuplicateMerge(
  flagged: DuplicateCandidate,
  target: DuplicateCandidate,
): Result<DuplicateMergePlan, DuplicateMergeError> {
  // El puntero solo no alcanza: el golden usa duplicate_of_id para volume_recruiting (seed)
  if (
    flagged.id === target.id ||
    flagged.duplicateOfId !== target.id ||
    !flagged.flags.includes(POSSIBLE_DUPLICATE_FLAG)
  ) {
    return err("not_a_duplicate_pair");
  }
  if (flagged.hasHistory && target.hasHistory) return err("both_have_history");

  const [survivor, absorbed] = flagged.hasHistory ? [flagged, target] : [target, flagged];
  const takeJdFromAbsorbed = absorbed.jdLength > survivor.jdLength;
  return ok({
    survivorId: survivor.id,
    absorbedId: absorbed.id,
    takeJdFromAbsorbed,
    firstSeenAt:
      absorbed.firstSeenAt < survivor.firstSeenAt ? absorbed.firstSeenAt : survivor.firstSeenAt,
    flags: [...new Set([...survivor.flags, ...absorbed.flags])].filter(
      (f) => f !== POSSIBLE_DUPLICATE_FLAG,
    ),
    canonicalUrl: survivor.canonicalUrl ?? absorbed.canonicalUrl,
    enqueueEvaluation: takeJdFromAbsorbed && survivor.status === "pendiente_jd",
  });
}
