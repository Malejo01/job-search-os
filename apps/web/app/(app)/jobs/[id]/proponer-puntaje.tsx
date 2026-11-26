import { buttonClasses } from "@/components/ui";
import { formatDecimal, formatScoreNumber } from "@/lib/labels";
import { DETALLE_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { humanScoreAction } from "./actions";

const T = DETALLE_TEXTOS.proponerPuntaje;

/**
 * «Proponer otro puntaje» (R30-11, antes «Corregir el puntaje»). Solo lo ven testers y admins: quien
 * lo monta decide con `canViewRecorrido(userId)` en el servidor y no lo renderiza para el resto.
 * Sigue guardando `human_score` y `human_note`; no cambia el puntaje que se ve.
 */
export function ProponerPuntaje({
  jobId,
  evaluationId,
  score,
  humanScore,
  humanNote,
}: {
  jobId: string;
  evaluationId: string;
  score: number;
  humanScore: number | null;
  humanNote: string | null;
}) {
  return (
    <details open={humanScore !== null} className="rounded-card border border-line p-3 text-sm">
      <summary className="cursor-pointer font-semibold">{T.titulo}</summary>
      <p className="mt-1 text-xs text-fg-muted">{T.aclaracion}</p>
      {/* key: al guardar un motivo o un puntaje el formulario se remonta con lo guardado */}
      <form
        key={`${humanScore ?? ""}|${humanNote ?? ""}`}
        action={humanScoreAction}
        className="mt-2 flex flex-col gap-2"
      >
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="evaluationId" value={evaluationId} />
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            {T.campoPuntaje}
            <input
              name="humanScore"
              type="number"
              min={0}
              max={10}
              step={0.5}
              inputMode="decimal"
              defaultValue={humanScore ?? ""}
              className="w-28 rounded-control border-2 border-line-strong px-2 py-2 text-base"
            />
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-fg-subtle">
            {T.campoNota}
            <input
              name="humanNote"
              type="text"
              defaultValue={humanNote ?? ""}
              placeholder={T.notaEjemplo}
              className="rounded-control border-2 border-line-strong px-2 py-2 text-base"
            />
          </label>
          <button type="submit" className={buttonClasses({ size: "sm", variant: "secondary" })}>
            {T.guardar}
          </button>
        </div>
        {humanScore !== null ? (
          <p className="text-xs text-fg-subtle">
            {llenarTexto(T.guardado, {
              puntaje: formatScoreNumber(humanScore),
              diferencia: formatDecimal(humanScore - score, 1),
            })}
          </p>
        ) : null}
      </form>
    </details>
  );
}
