import { AutoRefresh } from "@/app/(app)/jobs/auto-refresh";
import type { FirstOffer } from "@/lib/first-offers";
import { safeHttpUrl, SOURCE_LABELS } from "@/lib/labels";

/** Nombre de la fuente para «Publicado en …»: el de SOURCE_LABELS; sin fuente conocida, texto neutro. */
function sourceLabel(kind: string | null): string {
  return (kind && SOURCE_LABELS[kind]) || "la fuente original";
}

function ScoreBadge({ offer }: { offer: FirstOffer }) {
  if (offer.score !== null) {
    return (
      <span
        data-testid="first-offer-score"
        className="shrink-0 rounded-md bg-zinc-900 px-2 py-0.5 text-sm font-semibold text-white"
      >
        <span className="sr-only">Score </span>
        {Math.round(offer.score * 10) / 10}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-sm text-zinc-700">
      {offer.evaluating ? "Evaluando…" : "Sin evaluar"}
    </span>
  );
}

/**
 * Lista de «Tus primeras ofertas»: título, empresa, score (o «Evaluando…» / «Sin evaluar») y la
 * atribución a la fuente en llano, con el link al aviso original. Sin logos. El link lleva
 * `noopener` pero NO `nofollow`: es una atribución, no publicidad. Mientras alguna esté en cola
 * se vuelve a pedir la página cada pocos segundos.
 */
export function FirstOffersList({ offers }: { offers: FirstOffer[] }) {
  return (
    <>
      <ul className="flex list-none flex-col gap-2 p-0" aria-label="Tus primeras ofertas">
        {offers.map((o) => {
          const url = safeHttpUrl(o.sourceUrl);
          return (
            <li
              key={o.id}
              data-testid="first-offer"
              className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-white px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words text-zinc-900">{o.title}</p>
                  <p className="text-sm break-words text-zinc-700">{o.company}</p>
                </div>
                <ScoreBadge offer={o} />
              </div>
              <p className="text-xs text-zinc-600">
                Publicado en {sourceLabel(o.sourceKind)}
                {url ? (
                  <>
                    {" · "}
                    <a href={url} target="_blank" rel="noopener" className="underline">
                      Ver el aviso original ↗
                    </a>
                  </>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
      <AutoRefresh active={offers.some((o) => o.evaluating)} />
    </>
  );
}
