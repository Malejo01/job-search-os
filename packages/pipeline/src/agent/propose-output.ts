import type { ProposalFailure } from "./proposal";
import type { Proposal } from "./types";

/**
 * Resultado de una tool `propose_*` (AG-3). La tarjeta sale de `proposal`; al modelo vuelve solo
 * un resumen (`proposeModelText`): destino, nombres de campo y motivos. Nunca valores, citas ni
 * `formValues`: el modelo no necesita volver a ver los datos para decirle a la persona qué propuso.
 */
export type ProposeOutput =
  | { ok: true; proposal: Proposal }
  | { ok: false; code: ProposalFailure["code"]; dropped: ProposalFailure["dropped"] };

export function isProposeOutput(v: unknown): v is ProposeOutput {
  return typeof v === "object" && v !== null && "ok" in v && typeof v.ok === "boolean";
}

export function proposeModelText(out: unknown): string {
  if (!isProposeOutput(out)) return JSON.stringify({ error: "tool_fallo" });
  if (out.ok) {
    return JSON.stringify({
      propuesta_lista: true,
      destino: out.proposal.destination,
      cambios: out.proposal.diffs.map((d) => d.field),
      descartados: out.proposal.dropped.map((d) => ({ field: d.field, reason: d.reason })),
      nota: "La persona la revisa en una tarjeta y decide si la carga en el formulario. No está guardada.",
    });
  }
  return JSON.stringify({
    propuesta_lista: false,
    motivo: out.code,
    descartados: out.dropped.map((d) => ({ field: d.field, reason: d.reason })),
  });
}
