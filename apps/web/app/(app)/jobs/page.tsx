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
import { Alert, EmptyState, buttonClasses, textLinkClasses } from "@/components/ui";
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
          <h1 className="text-title font-semibold">Ofertas</h1>
          <p className="text-xs text-fg-subtle">
            {rows.length === LIST_LIMIT
              ? `Mostrando las primeras ${LIST_LIMIT}`
              : `${rows.length} ${rows.length === 1 ? "oferta" : "ofertas"}`}
            , ordenadas por score, riesgos y fecha
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
          <Link href="/jobs/new" className={buttonClasses({ size: "sm", className: "shrink-0" })}>
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
        <Alert tone="warning" role={null}>
          <p>
            Viendo solo posibles duplicados ·{" "}
            <Link href="/jobs" className="underline">
              ver todas
            </Link>
          </p>
        </Alert>
      ) : duplicates > 0 ? (
        <Alert tone="warning" role={null}>
          <p>
            <Link href="/jobs?duplicados=1" className="underline">
              {duplicates === 1
                ? "1 posible duplicado para revisar"
                : `${duplicates} posibles duplicados para revisar`}
            </Link>
          </p>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/jobs${listQuery({ ...filters, idioma: filters.idioma ? null : "es" })}`}
          aria-current={filters.idioma === "es" ? "true" : undefined}
          data-testid="chip-en-espanol"
          aria-describedby={filters.idioma === "es" ? "chip-en-espanol-ayuda" : undefined}
          className={`inline-flex min-h-11 items-center rounded-pill border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            filters.idioma === "es"
              ? "border-brand bg-brand text-brand-contrast"
              : "border-line-strong bg-surface text-fg"
          }`}
        >
          En español
        </Link>
        {filters.idioma === "es" ? (
          <p id="chip-en-espanol-ayuda" className="text-xs text-fg-subtle">
            Solo las ofertas que encontramos nosotros: las que cargaste vos no tienen idioma
            guardado.
          </p>
        ) : null}
      </div>
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
            <p className="text-xs text-fg-subtle" data-testid="pre-score-explain">
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

const EMPTY_LINK = textLinkClasses({ block: true });

/**
 * Lista vacía. Si hay ofertas sin evaluar que los filtros esconden, lo dice y las muestra; si no
 * hay ninguna oferta, explica cómo conseguir las primeras.
 */
function EmptyList({ counts, reviewedAll }: { counts: JobCounts | null; reviewedAll: boolean }) {
  if (reviewedAll) {
    return (
      <EmptyState
        action={
          <Link href="/jobs?estado=todas" className={EMPTY_LINK}>
            Ver todas las ofertas
          </Link>
        }
      >
        No quedan ofertas sin revisar en este período.
      </EmptyState>
    );
  }
  const porEvaluar = counts?.porEvaluar ?? 0;
  const sinDescripcion = counts?.sinDescripcion ?? 0;
  if (porEvaluar > 0 || sinDescripcion > 0) {
    // Las acciones van dentro de cada bloque: son dos caminos distintos, no uno solo
    return (
      <EmptyState data-testid="jobs-empty-unevaluated" action={null}>
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
              Ver las ofertas sin evaluar
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
              {sinDescripcion === 1 ? "Completar la descripción" : "Completar las descripciones"}
            </Link>
          </div>
        ) : null}
      </EmptyState>
    );
  }
  if (counts !== null && counts.total === 0) {
    return (
      <EmptyState data-testid="jobs-empty-none" title="Todavía no tenés ofertas" action={null}>
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
              Esperar las ofertas que sumamos cada día: elegí tus puestos
            </Link>
          </li>
        </ul>
      </EmptyState>
    );
  }
  return (
    <EmptyState
      action={
        <Link href="/jobs?estado=todas" className={EMPTY_LINK}>
          Ver todas las ofertas
        </Link>
      }
    >
      Ninguna oferta coincide con estos filtros.
    </EmptyState>
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
      className={`flex flex-col gap-1 rounded-control px-3 py-2 text-sm ${done ? "bg-success-soft text-success" : "bg-surface-subtle text-fg-muted"}`}
    >
      <p>
        <strong>
          {revisadas} de {total}
        </strong>{" "}
        {total === 1 ? "oferta recomendada (verde)" : "ofertas recomendadas (verdes)"}{" "}
        {rangeLabel(filters)} {total === 1 ? "revisada" : "revisadas"}
        {done ? " · terminaste" : ""}
      </p>
      <div
        role="progressbar"
        aria-label="Ofertas verdes revisadas"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={revisadas}
        className="h-1.5 overflow-hidden rounded-pill bg-surface-strong"
      >
        <div
          className={`h-full rounded-pill ${done ? "bg-success" : "bg-info"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
