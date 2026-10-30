import { attributionFor } from "@job-search-os/pipeline";
import {
  ACTION_LABELS,
  SCORE_CLASSES,
  formatScoreNumber,
  riskLabel,
  safeHttpUrl,
  scoreTone,
} from "@/lib/labels";
import { RequisitosDelAviso } from "@/components/requisitos-del-aviso";
import type { DemoEvaluationRow } from "@/lib/demo";
import type { ChecklistView } from "@/lib/job-detail";
import { MODALITY_LABELS, modalityKey } from "../../ofertas/job-card";
import { Feedback } from "./feedback";

const BAR_COLOR = {
  alto: "bg-success-strong",
  medio: "bg-warning-strong",
  bajo: "bg-fg-subtle",
  none: "bg-line-control",
};

function Reasons({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-semibold">{title}</h4>
      {items.length ? (
        <ul className="list-disc pl-5 text-sm text-fg">
          {items.map((text) => (
            <li key={text} className="break-words">
              {text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-subtle">Nada para destacar.</p>
      )}
    </div>
  );
}

/**
 * Tarjeta de una evaluación de la demo (ronda 74). Sin la JD. `tour` marca la primera tarjeta con
 * los `data-tour` (`demo:*`) que resalta el recorrido. Server Component; solo 👍/👎 es de cliente.
 */
export function EvaluationCard({
  row,
  tour,
  checklist = null,
}: {
  row: DemoEvaluationRow;
  tour: boolean;
  /** Checklist ya validado (ronda 104). null en las evaluaciones anteriores a la ronda 115: sin él no se muestra. */
  checklist?: ChecklistView | null;
}) {
  const modality = modalityKey(row.modality);
  const attribution = attributionFor(row.sourceKind, { company: row.companyRaw });
  const url = safeHttpUrl(row.sourceUrl);
  const tone = scoreTone(row.score);
  const step = (anchor: string) => (tour ? { "data-tour": anchor } : {});
  const against = [...row.gaps, ...row.bloqueadores, ...row.riesgos.map(riskLabel)];
  return (
    <li data-testid="demo-card" className="min-w-0 rounded-card border border-line bg-surface p-4">
      <article className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="break-words text-base font-semibold">{row.title}</h3>
          <p className="break-words text-sm text-fg">
            {row.companyRaw}
            {row.locationRaw ? ` · ${row.locationRaw}` : ""}
          </p>
          <p className="text-xs text-fg-muted">{MODALITY_LABELS[modality]}</p>
        </div>

        <div {...step("demo:puntaje")} className="flex flex-col gap-1 rounded-control p-1">
          <p className="flex items-baseline gap-2 text-sm">
            <span
              className={`rounded-control px-2 py-0.5 text-base font-semibold ring-1 ${SCORE_CLASSES[tone]}`}
            >
              {formatScoreNumber(row.score)}
            </span>
            <span className="text-fg-muted">de 10</span>
          </p>
          <div aria-hidden="true" className="h-2 w-full rounded-pill bg-surface-muted">
            <div
              className={`h-2 rounded-pill ${BAR_COLOR[tone]}`}
              style={{ width: `${Math.max(0, Math.min(10, row.score)) * 10}%` }}
            />
          </div>
        </div>

        <div {...step("demo:por-que")} className="grid gap-3 rounded-control p-1 sm:grid-cols-2">
          <Reasons title="Por qué sí" items={row.matchFuerte} />
          <Reasons title="Por qué no" items={against} />
        </div>

        {checklist ? <RequisitosDelAviso checklist={checklist} compact /> : null}

        <p {...step("demo:accion")} className="rounded-control p-1 text-sm">
          <span className="text-fg-muted">Acción sugerida: </span>
          <span className="font-semibold">{ACTION_LABELS[row.accion] ?? row.accion}</span>
        </p>

        <p className="text-xs text-fg-muted">
          {attribution ? attribution.text : null}
          {url ? (
            <>
              {attribution ? " · " : null}
              {/* Sin nofollow ni noreferrer: Remote OK exige un link seguible (ver SourceAttribution) */}
              <a
                href={url}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center text-fg-muted underline underline-offset-2 hover:text-fg"
              >
                Ver el aviso original ↗<span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </>
          ) : null}
        </p>
        <Feedback title={row.title} />
      </article>
    </li>
  );
}
