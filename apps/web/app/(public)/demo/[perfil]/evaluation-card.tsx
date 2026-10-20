import { attributionFor } from "@job-search-os/pipeline";
import {
  ACTION_LABELS,
  SCORE_CLASSES,
  formatScoreNumber,
  riskLabel,
  safeHttpUrl,
  scoreTone,
} from "@/lib/labels";
import type { DemoEvaluationRow } from "@/lib/demo";
import { MODALITY_LABELS, modalityKey } from "../../ofertas/job-card";
import { Feedback } from "./feedback";

const BAR_COLOR = {
  alto: "bg-emerald-600",
  medio: "bg-amber-500",
  bajo: "bg-zinc-500",
  none: "bg-zinc-400",
};

function Reasons({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-semibold">{title}</h4>
      {items.length ? (
        <ul className="list-disc pl-5 text-sm text-zinc-800">
          {items.map((text) => (
            <li key={text} className="break-words">
              {text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-600">Nada para destacar.</p>
      )}
    </div>
  );
}

/**
 * Tarjeta de una evaluación de la demo (ronda 74). Sin la JD. `tour` marca la primera tarjeta con
 * los `data-tour-step` que resalta el recorrido. Server Component; solo 👍/👎 es de cliente.
 */
export function EvaluationCard({ row, tour }: { row: DemoEvaluationRow; tour: boolean }) {
  const modality = modalityKey(row.modality);
  const attribution = attributionFor(row.sourceKind, { company: row.companyRaw });
  const url = safeHttpUrl(row.sourceUrl);
  const tone = scoreTone(row.score);
  const step = (n: number) => (tour ? { "data-tour-step": n } : {});
  const against = [...row.gaps, ...row.bloqueadores, ...row.riesgos.map(riskLabel)];
  return (
    <li data-testid="demo-card" className="min-w-0 rounded-md border border-zinc-200 bg-white p-4">
      <article className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="break-words text-base font-semibold">{row.title}</h3>
          <p className="break-words text-sm text-zinc-800">
            {row.companyRaw}
            {row.locationRaw ? ` · ${row.locationRaw}` : ""}
          </p>
          <p className="text-xs text-zinc-700">{MODALITY_LABELS[modality]}</p>
        </div>

        <div {...step(2)} className="flex flex-col gap-1 rounded-md p-1">
          <p className="flex items-baseline gap-2 text-sm">
            <span
              className={`rounded px-2 py-0.5 text-base font-semibold ring-1 ${SCORE_CLASSES[tone]}`}
            >
              {formatScoreNumber(row.score)}
            </span>
            <span className="text-zinc-700">de 10</span>
          </p>
          <div aria-hidden="true" className="h-2 w-full rounded bg-zinc-100">
            <div
              className={`h-2 rounded ${BAR_COLOR[tone]}`}
              style={{ width: `${Math.max(0, Math.min(10, row.score)) * 10}%` }}
            />
          </div>
        </div>

        <div {...step(3)} className="grid gap-3 rounded-md p-1 sm:grid-cols-2">
          <Reasons title="Por qué sí" items={row.matchFuerte} />
          <Reasons title="Por qué no" items={against} />
        </div>

        <p {...step(4)} className="rounded-md p-1 text-sm">
          <span className="text-zinc-700">Acción sugerida: </span>
          <span className="font-semibold">{ACTION_LABELS[row.accion] ?? row.accion}</span>
        </p>

        <p className="text-xs text-zinc-700">
          {attribution ? attribution.text : null}
          {url ? (
            <>
              {attribution ? " · " : null}
              {/* Sin nofollow ni noreferrer: Remote OK exige un link seguible (ver SourceAttribution) */}
              <a
                href={url}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center text-zinc-800 underline"
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
