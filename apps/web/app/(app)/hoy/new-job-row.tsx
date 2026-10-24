import Link from "next/link";
import type { JobListRow } from "@/lib/jobs";
import { ACTION_LABELS, SCORE_CLASSES, scoreTone } from "@/lib/labels";

/** Fila compacta de «Lo nuevo»: score, título, empresa y acción sugerida. Server Component. */
export function NewJobRow({ job }: { job: JobListRow }) {
  const tone = scoreTone(job.score);
  const action = job.accion ? (ACTION_LABELS[job.accion] ?? null) : null;
  return (
    <li data-testid="hoy-nuevo-fila" className="flex items-center gap-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-base font-semibold ring-1 ${SCORE_CLASSES[tone]}`}
      >
        <span className="sr-only">Puntaje </span>
        {job.score ?? "–"}
        {job.score !== null ? <span className="sr-only"> de 10</span> : null}
      </span>
      <Link
        href={`/jobs/${job.id}`}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
      >
        <span className="truncate text-sm font-medium text-zinc-900">{job.title}</span>
        <span className="truncate text-xs text-zinc-600">{job.company}</span>
      </Link>
      {action ? (
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-800">
          {action}
        </span>
      ) : null}
    </li>
  );
}
