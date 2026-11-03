import Link from "next/link";
import { Badge, ScoreBadge } from "@/components/ui";
import type { JobListRow } from "@/lib/jobs";
import { ACTION_LABELS } from "@/lib/labels";

/**
 * Fila de «Lo nuevo» (C7-7, manual P2): score, título, empresa y lugar, una línea de por qué (lo
 * que tenés a favor, o lo que te falta) y la acción sugerida. Un solo link (el título) cubre toda
 * la fila; «Ver detalle» es la señal visual de que se puede tocar. Server Component.
 */
export function NewJobRow({ job }: { job: JobListRow }) {
  const action = job.accion ? (ACTION_LABELS[job.accion] ?? null) : null;
  const why = job.fit.favor
    ? job.fit.favor.text
    : job.fit.falta
      ? `${job.fit.falta.label}: ${job.fit.falta.text}`
      : null;
  return (
    <li
      data-testid="hoy-nuevo-fila"
      className="relative flex items-start gap-3 rounded-control border border-line p-3 hover:border-line-control"
    >
      <ScoreBadge score={job.score} as="text" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={`/jobs/${job.id}`}
          className="truncate text-[15px] font-bold text-fg after:absolute after:inset-0 after:rounded-control focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-focus"
        >
          {job.title}
        </Link>
        <span className="truncate text-xs text-fg-subtle">
          {[job.company, job.locationRaw].filter(Boolean).join(" · ")}
        </span>
        {why ? <span className="line-clamp-2 text-xs text-fg-muted">{why}</span> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {action ? <Badge shape="square">{action}</Badge> : null}
        <span
          aria-hidden="true"
          className="hidden rounded-control border-2 border-fg px-2.5 py-1 text-xs font-bold text-fg sm:inline-block"
        >
          Ver detalle
        </span>
      </div>
    </li>
  );
}
