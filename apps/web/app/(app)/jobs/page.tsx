import { schema as s } from "@job-search-os/db";
import { JOB_STATUSES } from "@job-search-os/pipeline";
import {
  countJobs,
  countPossibleDuplicates,
  listJobs,
  LIST_LIMIT,
  listQuery,
  parseJobFilters,
  reviewProgressFor,
  type JobCounts,
  type JobFilters as ListFilters,
} from "@/lib/jobs";
import { GuidedTour } from "@/components/guided-tour";
import { GUIDE_LABELS, GUIDE_STEPS } from "@/lib/guide";
import { PRE_SCORE_EXPLAIN, SOURCE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import Link from "next/link";
import { AutoRefresh } from "./auto-refresh";
import { EmailNudge } from "./email-nudge";
import { FirstSteps, firstStepsHidden } from "./first-steps";
import { JobFilters } from "./job-filters";
import { JobList } from "./job-list";
import { RoleGaps } from "./role-gaps";
import { RoleNudge } from "./role-nudge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ofertas" };

/** Lista de ofertas (JS-015): Server Component; filtros en la URL; la lista anima en cliente. */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const filters = parseJobFilters(params);
  const [rows, duplicates, progress] = await Promise.all([
    listJobs(userId, filters),
    countPossibleDuplicates(userId),
    reviewProgressFor(userId, filters),
  ]);
  const query = listQuery(filters);
  // Solo hace falta cuando la lista queda vacía: distingue "los filtros no coinciden" de "no hay nada"
  const counts = rows.length === 0 ? await countJobs(userId) : null;
  const stepsHidden = await firstStepsHidden(userId);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Ofertas</h1>
          <p className="text-xs text-zinc-600">
            {rows.length === LIST_LIMIT ? `primeras ${LIST_LIMIT}` : `${rows.length}`} · por score y
            fecha
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GuidedTour
            steps={GUIDE_STEPS.jobs}
            label={GUIDE_LABELS.panel}
            testId="guide"
            openerLabel={GUIDE_LABELS.opener}
            resume
          />
          <Link
            href="/jobs/new"
            className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            + Cargar oferta
          </Link>
        </div>
      </div>
      <FirstSteps userId={userId} />
      <RoleNudge userId={userId} />
      {/* D2: mientras la checklist está visible, su ítem 6 reemplaza al aviso de email */}
      {stepsHidden ? <EmailNudge userId={userId} /> : null}
      <RoleGaps userId={userId} />
      {/* Posibles duplicados (JS-025): se revisan a mano, desde el detalle */}
      {filters.duplicates ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Viendo solo posibles duplicados ·{" "}
          <Link href="/jobs" className="underline">
            ver todas
          </Link>
        </p>
      ) : duplicates > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Link href="/jobs?duplicados=1" className="underline">
            {duplicates === 1
              ? "1 posible duplicado para revisar"
              : `${duplicates} posibles duplicados para revisar`}
          </Link>
        </p>
      ) : null}
      {progress.total > 0 ? <ReviewProgress {...progress} filters={filters} /> : null}
      <JobFilters
        value={{
          score: filters.scoreMin === null ? "" : String(filters.scoreMin),
          fuente: filters.source ?? "",
          estado: filters.status ?? "",
          desde: filters.since ?? "",
          periodo: filters.periodo ?? "",
        }}
        sources={s.sourceKind.enumValues.map((k) => ({ value: k, label: SOURCE_LABELS[k] ?? k }))}
        statuses={JOB_STATUSES.map((k) => ({ value: k, label: STATUS_LABELS[k] ?? k }))}
      />
      {rows.length === 0 ? (
        <EmptyList
          counts={counts}
          reviewedAll={
            filters.status === null && progress.total > 0 && progress.revisadas === progress.total
          }
        />
      ) : (
        <>
          {rows.some((r) => !r.evaluating && r.score === null && r.preScore !== null) ? (
            <p className="text-xs text-zinc-600" data-testid="pre-score-explain">
              {PRE_SCORE_EXPLAIN} El número va de 0 a 10.
            </p>
          ) : null}
          <JobList rows={rows} query={query} />
        </>
      )}
      <AutoRefresh active={rows.some((r) => r.evaluating)} />
    </section>
  );
}

const EMPTY_BOX =
  "flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-700";
const EMPTY_LINK =
  "inline-flex min-h-11 items-center font-medium text-sky-800 underline underline-offset-2";

/**
 * Lista vacía. Si hay ofertas sin evaluar que los filtros esconden, lo dice y las muestra; si no
 * hay ninguna oferta, explica cómo conseguir las primeras.
 */
function EmptyList({ counts, reviewedAll }: { counts: JobCounts | null; reviewedAll: boolean }) {
  if (reviewedAll) {
    return <p className={EMPTY_BOX}>No quedan ofertas sin revisar en este período.</p>;
  }
  const porEvaluar = counts?.porEvaluar ?? 0;
  const sinDescripcion = counts?.sinDescripcion ?? 0;
  if (porEvaluar > 0 || sinDescripcion > 0) {
    return (
      <div className={EMPTY_BOX} data-testid="jobs-empty-unevaluated">
        <p>
          Ninguna oferta coincide con estos filtros.{" "}
          <Link href="/jobs?estado=todas" className={EMPTY_LINK}>
            Ver todas las ofertas
          </Link>
        </p>
        {porEvaluar > 0 ? (
          <div className="mt-1">
            <p>
              {porEvaluar === 1
                ? "Tenés 1 oferta que todavía no evaluamos"
                : `Tenés ${porEvaluar} ofertas que todavía no evaluamos`}
            </p>
            <Link href="/jobs?estado=prefiltrada" className={EMPTY_LINK}>
              verlas
            </Link>
          </div>
        ) : null}
        {sinDescripcion > 0 ? (
          <div className="mt-1">
            <p>
              {sinDescripcion === 1
                ? "Tenés 1 oferta sin descripción"
                : `Tenés ${sinDescripcion} ofertas sin descripción`}
            </p>
            <Link href="/jobs/pending-jd" className={EMPTY_LINK}>
              completarla{sinDescripcion === 1 ? "" : "s"}
            </Link>
          </div>
        ) : null}
      </div>
    );
  }
  if (counts !== null && counts.total === 0) {
    return (
      <div className={EMPTY_BOX} data-testid="jobs-empty-none">
        <p className="font-medium text-zinc-900">Todavía no tenés ofertas</p>
        <p>Podés empezar de tres maneras:</p>
        <ul className="flex flex-col items-center">
          <li>
            <Link href="/jobs/new" className={EMPTY_LINK}>
              Cargar una oferta que viste
            </Link>
          </li>
          <li>
            <Link href="/settings/asistente" className={EMPTY_LINK}>
              Reenviar tus alertas de empleo por email
            </Link>
          </li>
          <li>
            <Link href="/settings#puesto" className={EMPTY_LINK}>
              Esperar las ofertas que sumamos cada día para tus puestos
            </Link>
          </li>
        </ul>
      </div>
    );
  }
  return (
    <div className={EMPTY_BOX}>
      <p>Ninguna oferta coincide con estos filtros.</p>
      <p>
        <Link href="/jobs?estado=todas" className={EMPTY_LINK}>
          Ver todas las ofertas
        </Link>
      </p>
    </div>
  );
}

function rangeLabel(filters: ListFilters): string {
  if (filters.periodo === "hoy") return "de hoy";
  if (filters.periodo === "semana") return "de esta semana";
  if (filters.since) {
    const [, mes, dia] = filters.since.split("-");
    return `desde el ${Number(dia)}/${Number(mes)}`;
  }
  return "en total";
}

/**
 * "X de Y ofertas verdes revisadas" (JS-061). Cuenta las verdes del rango de fechas en CUALQUIER
 * estado; revisada = con una acción tomada, no solo abierta.
 */
function ReviewProgress({
  total,
  revisadas,
  filters,
}: {
  total: number;
  revisadas: number;
  filters: ListFilters;
}) {
  const done = revisadas === total;
  const pct = Math.round((revisadas / total) * 100);
  return (
    <div
      className={`flex flex-col gap-1 rounded-md px-3 py-2 text-sm ${done ? "bg-emerald-50 text-emerald-900" : "bg-zinc-50 text-zinc-700"}`}
    >
      <p>
        <strong>
          {revisadas} de {total}
        </strong>{" "}
        {total === 1 ? "oferta verde" : "ofertas verdes"} {rangeLabel(filters)}{" "}
        {total === 1 ? "revisada" : "revisadas"}
        {done ? " · terminaste" : ""}
      </p>
      <div
        role="progressbar"
        aria-label="Ofertas verdes revisadas"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={revisadas}
        className="h-1.5 overflow-hidden rounded-full bg-zinc-200"
      >
        <div
          className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-sky-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
