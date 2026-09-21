import type { ApplicationOutcome } from "./feedback";
import type { JobStatus } from "./status";

/**
 * Corrección manual de estado (JS-028): la persona marcó un estado por error ("Rechazo
 * automático" en vez de "Entrevista", "Aplicada" sin haberse postulado) y lo quiere deshacer.
 *
 * No es un evento más de la máquina de estados (status.ts): los eventos modelan lo que pasa
 * con la oferta, y ninguno vuelve atrás. Esto es una corrección explícita, con reglas propias:
 * - Solo desde estados que marca la persona. Los del pipeline (nueva, prefiltrada,
 *   pendiente_jd, descartada_prefiltro, evaluada) se cambian con sus eventos, no a mano.
 * - Hacia estados posteriores a la evaluación, y solo si la oferta tiene evaluación: no se
 *   puede "volver a evaluada" algo que nunca se evaluó.
 * - Una oferta cerrada desde la cola de JD (sin evaluación ni JD) solo vuelve a pendiente_jd.
 */
const CORRECTABLE_FROM: readonly JobStatus[] = [
  "aplicada",
  "entrevista",
  "oferta",
  "rechazada",
  "rechazo_automatico",
  "descartada",
  "cerrada",
];

/** Destinos con evaluación, en el orden en que se muestran. */
const AFTER_EVALUATION: readonly JobStatus[] = [
  "evaluada",
  "aplicada",
  "entrevista",
  "oferta",
  "rechazada",
  "rechazo_automatico",
  "descartada",
  "cerrada",
];

export type CorrectionContext = { hasEvaluation: boolean; hasJd: boolean };

export class InvalidCorrectionError extends Error {
  constructor(
    public readonly from: JobStatus,
    public readonly to: JobStatus,
  ) {
    super(`corrección inválida: ${from} → ${to}`);
    this.name = "InvalidCorrectionError";
  }
}

/** Estados a los que se puede corregir desde `from` (para el selector de la UI). */
export function correctionTargets(from: JobStatus, ctx: CorrectionContext): JobStatus[] {
  if (!CORRECTABLE_FROM.includes(from)) return [];
  if (!ctx.hasEvaluation) return from === "cerrada" && !ctx.hasJd ? ["pendiente_jd"] : [];
  return AFTER_EVALUATION.filter((s) => s !== from);
}

/** Valida la corrección y devuelve el estado nuevo; lanza InvalidCorrectionError si no vale. */
export function correctStatus(from: JobStatus, to: JobStatus, ctx: CorrectionContext): JobStatus {
  if (!correctionTargets(from, ctx).includes(to)) throw new InvalidCorrectionError(from, to);
  return to;
}

/**
 * Qué pasa con la postulación (applications) al corregir a `to`, para que el feedback loop
 * (JS-036) no quede con datos que la corrección desmiente.
 */
export type ApplicationEffect =
  | { kind: "ensure"; outcome: ApplicationOutcome | null }
  | { kind: "remove" }
  | { kind: "if_exists"; outcome: ApplicationOutcome };

export function applicationEffect(to: JobStatus): ApplicationEffect {
  switch (to) {
    case "aplicada":
      return { kind: "ensure", outcome: null };
    case "entrevista":
      return { kind: "ensure", outcome: "entrevista" };
    case "oferta":
      return { kind: "ensure", outcome: "oferta" };
    case "rechazada":
      return { kind: "ensure", outcome: "rechazo_humano" };
    case "rechazo_automatico":
      return { kind: "ensure", outcome: "rechazo_automatico_otro" };
    case "cerrada":
      return { kind: "if_exists", outcome: "cerrada_antes" };
    default:
      // evaluada, descartada, pendiente_jd: no hubo postulación; la registrada era un error
      return { kind: "remove" };
  }
}
