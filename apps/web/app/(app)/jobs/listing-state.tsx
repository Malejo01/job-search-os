import { Icon } from "@/components/ui";
import { getJobListingState } from "@/lib/job-listing-state";
import { LISTADO_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { SaveButton, SavedMark } from "./save-button";

/**
 * Para el detalle (R30-03 y R30-07): la marca «Guardada» con su botón y, si la oferta viene del pool y
 * la fuente ya no la muestra, «Este aviso ya no figura en {fuente}». De lo que no viene del pool no se
 * afirma nada. Server Component, una consulta; se pone junto al título del detalle.
 */
export async function ListingState({
  userId,
  jobId,
  title,
}: {
  userId: string;
  jobId: string;
  title: string;
}) {
  const state = await getJobListingState(userId, jobId);
  if (!state) return null;
  const gone = state.goneFromSource
    ? state.sourceName
      ? llenarTexto(LISTADO_TEXTOS.vigencia.yaNoFigura, { fuente: state.sourceName })
      : LISTADO_TEXTOS.vigencia.yaNoFiguraSinFuente
    : null;
  return (
    <div className="flex flex-col gap-2" data-testid="detalle-listado">
      <div className="flex flex-wrap items-center gap-2">
        {state.savedAt ? <SavedMark /> : null}
        <SaveButton jobId={jobId} title={title} saved={state.savedAt !== null} />
      </div>
      {gone ? (
        <p
          data-testid="detalle-ya-no-figura"
          className="flex items-start gap-1.5 text-sm font-semibold text-fg-muted"
        >
          <Icon name="cruz" size={16} className="mt-0.5 shrink-0" />
          <span>{gone}</span>
        </p>
      ) : null}
    </div>
  );
}
