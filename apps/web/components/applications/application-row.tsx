import Link from "next/link";
import type { ReactNode } from "react";
import { APPLICATION_OUTCOMES } from "@job-search-os/pipeline";
import { buttonClasses, inputClasses } from "@/components/ui";
import type { ApplicationView } from "@/lib/applications";
import { ACTION_LABELS, OUTCOME_CLASSES, OUTCOME_LABELS, STATUS_LABELS } from "@/lib/labels";
import { setOutcomeAction } from "@/app/(app)/applications/actions";

function OutcomeForm({ a }: { a: ApplicationView }) {
  return (
    <form
      // Con lo guardado en la key, el form se remonta y sus defaultValue siguen a la base
      key={`${a.outcome}|${a.outcomeNote ?? ""}`}
      action={setOutcomeAction}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="applicationId" value={a.id} />
      <select
        name="outcome"
        defaultValue={a.outcome}
        className={inputClasses({ className: "sm:w-auto" })}
        aria-label="Resultado"
      >
        {APPLICATION_OUTCOMES.map((o) => (
          <option key={o} value={o}>
            {OUTCOME_LABELS[o] ?? o}
          </option>
        ))}
      </select>
      <input
        name="note"
        defaultValue={a.outcomeNote ?? ""}
        placeholder="Nota (opcional)"
        className={inputClasses({ className: "min-w-40 flex-1" })}
      />
      <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
        Guardar resultado
      </button>
    </form>
  );
}

/**
 * Fila plana de una postulación (R4-07). Es un `li` (los e2e buscan el `li` con el formulario).
 * `form`: "visible" en Activas y Esperando; "details" en los grupos plegados.
 */
export function ApplicationRow({
  a,
  form,
  actions,
}: {
  a: ApplicationView;
  form: "visible" | "details";
  actions?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/jobs/${a.jobId}`} className="font-bold text-fg hover:underline">
            {a.title}
          </Link>
          <p className="text-xs text-fg-subtle">
            {a.company} · {STATUS_LABELS[a.status] ?? a.status}
            {a.appliedAt ? ` · postulada ${a.appliedAt}` : ""}
            {a.channel ? ` · ${a.channel}` : ""}
            {a.score !== null
              ? ` · score ${a.score}${a.accion ? ` (${ACTION_LABELS[a.accion] ?? a.accion})` : ""}`
              : " · sin evaluación"}
            {a.model === "fake" ? " · modo demo" : ""}
          </p>
          {a.outcomeNote ? <p className="text-xs text-fg-subtle">{a.outcomeNote}</p> : null}
        </div>
        <span
          className={`rounded-pill px-2.5 py-0.5 text-xs font-bold ${OUTCOME_CLASSES[a.outcome] ?? ""}`}
        >
          {OUTCOME_LABELS[a.outcome] ?? a.outcome}
          {a.outcomeAt ? ` · ${a.outcomeAt}` : ""}
        </span>
      </div>
      {form === "visible" ? (
        <OutcomeForm a={a} />
      ) : (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-fg-subtle underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
            Cambiar resultado
          </summary>
          <div className="mt-1">
            <OutcomeForm a={a} />
          </div>
        </details>
      )}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </li>
  );
}
