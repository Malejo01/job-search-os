import { schema as s } from "@job-search-os/db";
import { JOB_STATUSES } from "@job-search-os/pipeline";
import { listJobs, LIST_LIMIT, parseJobFilters } from "@/lib/jobs";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import Link from "next/link";
import { AutoRefresh } from "./auto-refresh";
import { JobFilters } from "./job-filters";
import { JobList } from "./job-list";

export const dynamic = "force-dynamic";

/** Lista de ofertas (JS-015): Server Component; filtros en la URL; la lista anima en cliente. */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const filters = parseJobFilters(params);
  const rows = await listJobs(userId, filters);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Ofertas</h1>
        <p className="text-xs text-zinc-500">
          {rows.length === LIST_LIMIT ? `primeras ${LIST_LIMIT}` : `${rows.length}`} · por score y
          fecha ·{" "}
          <Link href="/jobs/new" className="text-sky-700 underline">
            nueva oferta
          </Link>
        </p>
      </div>
      <JobFilters
        value={{
          score: filters.scoreMin === null ? "" : String(filters.scoreMin),
          fuente: filters.source ?? "",
          estado: filters.status ?? "",
          desde: filters.since ?? "",
        }}
        sources={s.sourceKind.enumValues.map((k) => ({ value: k, label: SOURCE_LABELS[k] ?? k }))}
        statuses={JOB_STATUSES.map((k) => ({ value: k, label: STATUS_LABELS[k] ?? k }))}
      />
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Sin ofertas con estos filtros.
        </p>
      ) : (
        <JobList rows={rows} />
      )}
      <AutoRefresh active={rows.some((r) => r.evaluating)} />
    </section>
  );
}
