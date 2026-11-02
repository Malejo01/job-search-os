import Link from "next/link";
import { Badge, ScoreBadge } from "@/components/ui";
import type { JobListRow } from "@/lib/jobs";
import { ACTION_LABELS } from "@/lib/labels";

/** Fila compacta de «Lo nuevo»: score, título, empresa y acción sugerida. Server Component. */
export function NewJobRow({ job }: { job: JobListRow }) {
  const action = job.accion ? (ACTION_LABELS[job.accion] ?? null) : null;
  return (
    <li data-testid="hoy-nuevo-fila" className="flex items-center gap-3">
      <ScoreBadge score={job.score} size="sm" as="text" />
      <Link
        href={`/jobs/${job.id}`}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className="truncate text-sm font-medium text-fg">{job.title}</span>
        <span className="truncate text-xs text-fg-subtle">{job.company}</span>
      </Link>
      {action ? <Badge className="shrink-0">{action}</Badge> : null}
    </li>
  );
}
