"use client";

import type { JobStatus } from "@job-search-os/pipeline";
import { STATUS_LABELS } from "@/lib/labels";
import { correctStatusAction } from "./actions";

/**
 * Corregir un estado mal marcado (JS-028). Los botones de eventos no tienen vuelta atrás;
 * esto sí, con confirmación explícita. Las reglas (desde y hacia qué estados) viven en
 * pipeline/status-correction.ts; acá solo se muestran los destinos válidos.
 */
export function StatusCorrection({
  jobId,
  current,
  targets,
}: {
  jobId: string;
  current: JobStatus;
  targets: JobStatus[];
}) {
  const label = (s: string) => STATUS_LABELS[s] ?? s;
  return (
    <form
      action={correctStatusAction}
      onSubmit={(e) => {
        const to = new FormData(e.currentTarget).get("to");
        const ok = window.confirm(
          `¿Seguro que querés cambiar el estado de ${label(current)} a ${label(String(to))}?`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <fieldset className="flex flex-wrap items-end gap-2 rounded-card border border-dashed border-line-strong p-3">
        <legend className="px-1 text-xs text-fg-subtle">Corregir estado</legend>
        <input type="hidden" name="jobId" value={jobId} />
        <label className="flex flex-col gap-1 text-xs text-fg-subtle">
          Estado correcto
          <select
            name="to"
            defaultValue={targets[0]}
            className="rounded-control border border-line-strong px-2 py-1.5 text-sm text-fg"
          >
            {targets.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-control border border-line-control px-3 py-1.5 text-sm text-fg"
        >
          Corregir
        </button>
        <p className="w-full text-[11px] text-fg-subtle">
          Para cuando marcaste un estado por error. Volver a Evaluada o Descartada borra la
          postulación registrada.
        </p>
      </fieldset>
    </form>
  );
}
