import { schema as s } from "@job-search-os/db";
import { JOB_STATUSES, splitFarFromProfile } from "@job-search-os/pipeline";
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
  type JobListRow,
} from "@/lib/jobs";
import { GuidedTour } from "@/components/guided-tour";
import { GUIDE_LABELS, GUIDE_STEPS } from "@/lib/guide";
import { PRE_SCORE_EXPLAIN, SOURCE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import Link from "next/link";
import { Illustration } from "@/components/brand/illustration";
import {
  Alert,
  EmptyState,
  Icon,
  buttonClasses,
  filterChipClasses,
  textLinkClasses,
  type IconName,
} from "@/components/ui";
import { AutoRefresh } from "./auto-refresh";
import { EmailNudge } from "./email-nudge";
import { FirstSteps, firstStepsHidden } from "./first-steps";
import { JobFilters } from "./job-filters";
import { JobList } from "./job-list";
import { OfferPanel, OfferPanelHint } from "./offer-panel";
import { getJobDetail } from "@/lib/job-detail";
import { isUuid } from "@/lib/ids";
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
  // Una consulta agregada: el vacío la necesita y la columna de la derecha (P1) muestra las pendientes
  const counts = await countJobs(userId).catch(() => null);
  const stepsHidden = await firstStepsHidden(userId);
  // O3 (C9-9): la oferta elegida para el panel de la derecha, en la URL. Solo un id válido; si no
  // existe para esta persona (RLS), el panel muestra la indicación como si no hubiera ninguna.
  const ofertaParam = typeof params.oferta === "string" ? params.oferta : null;
  const selected = ofertaParam && isUuid(ofertaParam) ? ofertaParam : null;
  const panelJob = selected ? await getJobDetail(userId, selected).catch(() => null) : null;

  // Chips de filtro (C10-7, ofertas-pc.png): cada uno es un link con los filtros de la URL
  const chip = (patch: Partial<ListFilters>) => `/jobs${listQuery({ ...filters, ...patch })}`;
  const onlyDefault = filters.status === null && !filters.modalidad && !filters.idioma;

  return (
    <div data-ancho="completo" className="flex flex-col pb-10">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col sm:flex-row sm:items-center sm:gap-2 sm:px-10 sm:pt-[22px]">
        {/* En el celular el título va en el índigo, debajo de la barra (ofertas-cel.png) */}
        <div className="bg-ink px-5 pb-[18px] sm:mr-3.5 sm:bg-transparent sm:p-0">
          <h1 className="text-[26px] leading-tight font-extrabold text-on-ink sm:text-[28px] sm:text-fg">
            Tus ofertas
          </h1>
        </div>
        <nav
          aria-label="Filtros rápidos"
          className="flex gap-1.5 overflow-x-auto px-3.5 pt-1 sm:gap-2 sm:overflow-visible sm:p-0"
        >
          <Link
            href={chip({ status: null, modalidad: null, idioma: null })}
            aria-current={onlyDefault ? "true" : undefined}
            className={filterChipClasses({
              compact: true,
              selected: onlyDefault,
              className: "shrink-0",
            })}
          >
            {onlyDefault ? `Para revisar · ${rows.length}` : "Para revisar"}
          </Link>
          <Link
            href={chip({ status: filters.status === "todas" ? null : "todas" })}
            aria-current={filters.status === "todas" ? "true" : undefined}
            className={filterChipClasses({
              compact: true,
              selected: filters.status === "todas",
              className: "shrink-0",
            })}
          >
            Todas
          </Link>
          <Link
            href={chip({ modalidad: filters.modalidad ? null : "remoto" })}
            aria-current={filters.modalidad ? "true" : undefined}
            className={filterChipClasses({
              compact: true,
              selected: Boolean(filters.modalidad),
              className: "shrink-0",
            })}
          >
            Remoto
          </Link>
          {/* En el celular la fila se desliza: «En español» queda a la derecha de los tres de la
              referencia (ofertas-cel.png) */}
          <Link
            href={chip({ idioma: filters.idioma ? null : "es" })}
            aria-current={filters.idioma === "es" ? "true" : undefined}
            data-testid="chip-en-espanol"
            aria-describedby={filters.idioma === "es" ? "chip-en-espanol-ayuda" : undefined}
            className={filterChipClasses({
              compact: true,
              selected: filters.idioma === "es",
              className: "shrink-0",
            })}
          >
            En español
          </Link>
        </nav>
        <p className="ml-auto hidden text-[13px] font-bold text-fg-subtle sm:block">
          Ordenadas por afinidad
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-3.5 pt-3 sm:px-10 sm:pt-[18px]">
        {filters.idioma === "es" ? (
          <p id="chip-en-espanol-ayuda" className="text-xs text-fg-subtle">
            Solo las ofertas que encontramos nosotros: las que cargaste vos no tienen idioma
            guardado.
          </p>
        ) : null}
        <FirstSteps userId={userId} />
        <RoleNudge userId={userId} />
        {/* D2: mientras la checklist está visible, su ítem 6 reemplaza al aviso de email */}
        {stepsHidden ? <EmailNudge userId={userId} /> : null}
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

        <div className="grid items-start gap-6 lg:grid-cols-[470px_1fr]">
          <section aria-labelledby="lista-titulo" className="flex min-w-0 flex-col gap-3">
            <h2 id="lista-titulo" className="sr-only">
              {rows.length === LIST_LIMIT
                ? `Las primeras ${LIST_LIMIT} ofertas`
                : `${rows.length} ${rows.length === 1 ? "oferta" : "ofertas"}`}
              , ordenadas por afinidad
            </h2>
            {rows.length === 0 ? (
              <EmptyList
                counts={counts}
                reviewedAll={
                  filters.status === null &&
                  progress.total > 0 &&
                  progress.revisadas === progress.total
                }
              />
            ) : (
              <>
                {rows.some((r) => !r.evaluating && r.score === null && r.preScore !== null) ? (
                  <p className="text-xs text-fg-subtle" data-testid="pre-score-explain">
                    {PRE_SCORE_EXPLAIN} El número va de 0 a 10.
                  </p>
                ) : null}
                <JobListSplit rows={rows} query={query} selected={panelJob?.id ?? null} />
              </>
            )}
            <AutoRefresh active={rows.some((r) => r.evaluating)} />
          </section>
          {panelJob ? (
            <OfferPanel job={panelJob} detailHref={`/jobs/${panelJob.id}${query}`} />
          ) : (
            <JobsAside pending={counts?.sinDescripcion ?? 0} />
          )}
        </div>

        {/* Lo que no está en la referencia va debajo de la lista (C10-7): la guía y «+ Cargar
            oferta» a la vista (el panel de la guía no se vería dentro de un desplegable cerrado), y
            los filtros finos y el avance en «Más filtros y herramientas» */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
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
        {/* Abierto si la URL ya trae un filtro fino: se ve qué está filtrando */}
        <details
          data-testid="jobs-herramientas"
          open={
            filters.scoreMin !== null ||
            filters.source !== null ||
            (filters.status !== null && filters.status !== "todas") ||
            filters.since !== null ||
            filters.periodo !== null ||
            undefined
          }
        >
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold text-brand-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
            Más filtros y herramientas
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <RoleGaps userId={userId} />
            {progress.total > 0 ? <ReviewProgress {...progress} filters={filters} /> : null}
            <JobFilters
              value={{
                score: filters.scoreMin === null ? "" : String(filters.scoreMin),
                fuente: filters.source ?? "",
                estado: filters.status ?? "",
                desde: filters.since ?? "",
                periodo: filters.periodo ?? "",
              }}
              sources={s.sourceKind.enumValues.map((k) => ({
                value: k,
                label: SOURCE_LABELS[k] ?? k,
              }))}
              statuses={JOB_STATUSES.map((k) => ({ value: k, label: STATUS_LABELS[k] ?? k }))}
            />
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * Columna de la derecha (C7-6, manual P1), solo en pantalla ancha: cuántas ofertas esperan la
 * descripción, cargar una a mano y el recordatorio de que la postulación la hace la persona. En el
 * celular, lo mismo está en el menú y en «+ Cargar oferta».
 */
function JobsAside({ pending }: { pending: number }) {
  return (
    <aside aria-label="Atajos" className="hidden min-w-0 flex-col gap-3 lg:flex">
      <OfferPanelHint />
      {pending > 0 ? (
        <div className="flex flex-col gap-2 rounded-card border border-ink-line bg-ink p-4 text-on-ink">
          <p className="font-display text-lg font-bold">
            {pending === 1
              ? "1 oferta espera descripción"
              : `${pending} ofertas esperan descripción`}
          </p>
          <p className="text-sm text-on-ink-muted">
            Pegá el texto del aviso y la evaluamos con tu perfil.
          </p>
          <Link
            href="/jobs/pending-jd"
            className="inline-flex min-h-11 items-center self-start pressable edge-4 rounded-pill border-edge-brand bg-brand px-4 text-sm font-extrabold text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {pending === 1 ? "Completarla" : "Completarlas"}
          </Link>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 rounded-card bg-surface p-4">
        <p className="text-sm font-bold">¿La oferta no está en la lista?</p>
        <Link href="/jobs/new" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          Cargala a mano
        </Link>
      </div>
      <p className="text-xs text-fg-subtle">
        Vos decidís: la postulación la hacés vos en el sitio del aviso. Nunca postulamos por vos.
      </p>
    </aside>
  );
}

const EMPTY_LINK = textLinkClasses({ block: true });

/** Qué hacer mientras no hay ofertas (V3): los tres caminos de siempre, como checklist. */
const EMPTY_STEPS: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  {
    href: "/settings#puesto",
    label: "Esperar las ofertas que sumamos cada día: elegí tus puestos",
    icon: "filtro",
  },
  {
    href: "/settings/asistente",
    label: "Reenviar tus alertas de empleo por email",
    icon: "alertas",
  },
  { href: "/jobs/new", label: "Cargar una oferta que viste", icon: "pegar" },
];

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
      // V3 (C9-13): ilustración chica, qué hacer mientras como checklist y una sola acción principal
      <EmptyState
        data-testid="jobs-empty-none"
        title="Todavía no tenés ofertas"
        illustration={<Illustration escena="vacio" className="w-40 sm:w-52" />}
        action={
          <Link href="/settings#puesto" className={buttonClasses()}>
            Elegir mis áreas
          </Link>
        }
      >
        <p>
          Todavía no llegó nada, pero estamos buscando todos los días. Mientras, dejá tu perfil a
          punto:
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-left">
          {EMPTY_STEPS.map((step) => (
            <li key={step.href} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-pill border-2 border-dashed border-line-control text-fg-muted"
              >
                <Icon name={step.icon} size={14} />
              </span>
              <Link href={step.href} className={EMPTY_LINK}>
                {step.label}
              </Link>
            </li>
          ))}
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
      className={`flex flex-col gap-1.5 rounded-control px-3 py-2 text-sm font-semibold ${done ? "bg-success-soft text-success" : "text-fg-muted"}`}
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
        className="h-1.5 overflow-hidden rounded-pill bg-line"
      >
        <div
          className={`h-full rounded-pill ${done ? "bg-success-strong" : "bg-brand-text"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * La lista con las «Lejos de tu perfil» siempre al final, debajo de su separador, sea cual sea el
 * orden (C9-5, decisión 7). La guía se ancla en la primera tarjeta de arriba.
 */
function JobListSplit({
  rows,
  query,
  selected,
}: {
  rows: JobListRow[];
  query: string;
  selected: string | null;
}) {
  // Una que se está reevaluando no es lejana todavía: se ve arriba con su sello «Leyendo…» (R-3)
  const { near, far } = splitFarFromProfile(rows, (r) => (r.evaluating ? null : r.score));
  return (
    <>
      {near.length ? <JobList rows={near} query={query} selected={selected} featuredFirst /> : null}
      {far.length ? (
        <section
          aria-labelledby="lejos-titulo"
          className="mt-1 flex flex-col gap-3"
          data-testid="lejanas"
        >
          <h2
            id="lejos-titulo"
            className="flex items-center gap-2.5 font-sans text-xs font-extrabold text-fg-subtle before:h-0.5 before:flex-1 before:bg-line-strong after:h-0.5 after:flex-1 after:bg-line-strong"
          >
            Lejos de tu perfil ({far.length})
          </h2>
          <JobList rows={far} query={query} tour={near.length === 0} selected={selected} />
        </section>
      ) : null}
    </>
  );
}
