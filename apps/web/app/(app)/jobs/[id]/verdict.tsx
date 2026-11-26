import type { HumanVerdict } from "@job-search-os/pipeline";
import { DETALLE_TEXTOS } from "@/lib/textos-rediseno";
import { humanVerdictAction } from "./actions";
import { VerdictButton } from "./verdict-button";
import { VerdictReason } from "./verdict-reason";

const T = DETALLE_TEXTOS.valoracion;

const OPTIONS: { verdict: HumanVerdict; label: string; name: string; emoji: string }[] = [
  { verdict: "de_acuerdo", label: T.si, name: "Sí, me sirve", emoji: "👍" },
  { verdict: "en_desacuerdo", label: T.no, name: "No, no me sirve", emoji: "👎" },
];

/**
 * «¿Te sirve esta evaluación?» (R30-11). Guarda al instante con una Server Action; volver a tocar el
 * botón apretado lo quita. «Sí» solo agradece; «No» abre los motivos. No es un puntaje: no entra en
 * el MAE ni en el snapshot, y no cambia el puntaje que se ve.
 */
export function Verdict({
  jobId,
  evaluationId,
  verdict,
  note,
}: {
  jobId: string;
  evaluationId: string;
  verdict: HumanVerdict | null;
  note: string | null;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line p-3 text-sm">
      <h2 className="font-semibold">{T.titulo}</h2>
      <div role="group" aria-label={T.titulo} className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => {
          const pressed = verdict === o.verdict;
          return (
            <form key={o.verdict} action={humanVerdictAction}>
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="evaluationId" value={evaluationId} />
              <input type="hidden" name="verdict" value={pressed ? "" : o.verdict} />
              <VerdictButton name={o.name} label={o.label} emoji={o.emoji} pressed={pressed} />
            </form>
          );
        })}
      </div>
      {verdict === "de_acuerdo" ? (
        <p role="status" data-testid="valoracion-gracias" className="text-fg">
          {T.gracias}
        </p>
      ) : null}
      {verdict === "en_desacuerdo" ? (
        <VerdictReason
          jobId={jobId}
          evaluationId={evaluationId}
          note={note}
          texts={{
            titulo: T.motivosTitulo,
            motivos: T.motivos,
            campo: T.motivoCampo,
            ayuda: T.ayuda,
            guardar: T.guardar,
            guardando: T.guardando,
            quitar: T.quitar,
            guardado: T.guardado,
            error: T.error,
          }}
        />
      ) : null}
    </section>
  );
}
