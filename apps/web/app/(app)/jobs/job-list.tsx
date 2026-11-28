import Link from "next/link";
import { Button, buttonClasses, cardClasses, Chip, cx, Icon, Seal } from "@/components/ui";
import { noCoincideLine, salaryLine, sinConfirmarLine } from "@/lib/card-view";
import type { ApplicationFollowUp } from "@/lib/applications";
import type { JobListRow } from "@/lib/jobs";
import { MODALITY_LABELS, PRE_SCORE_EXPLAIN } from "@/lib/labels";
import { LISTADO_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { discardJobAction, reviewAgainAction } from "./discard-actions";
import { SaveButton, SavedMark } from "./save-button";
import { SeguimientoPostulacion } from "./seguimiento-postulacion";

const T = LISTADO_TEXTOS;

/**
 * Lista de ofertas (JS-015; tarjeta de R30-04). Server Component, sin animación de entrada (decisión
 * 13). Lo único que se mueve es el hundimiento al tocar (CSS).
 *
 * `featured`: la tarjeta destacada (`.card`, sello 60/72): la elegida en el panel de la derecha o,
 * si no hay ninguna elegida, la primera. Las demás son `.cardl`.
 */
export function JobList({
  rows,
  query = "",
  tour = true,
  selected = null,
  featuredFirst = false,
  seguimiento = null,
}: {
  rows: JobListRow[];
  /** R34-04: en «Ya me postulé», la fecha y el estado de cada postulación (por id de oferta). */
  seguimiento?: ReadonlyMap<string, ApplicationFollowUp> | null;
  query?: string;
  /** La primera tarjeta lleva las anclas de la guía; la segunda lista (lejanas) no. */
  tour?: boolean;
  /** La oferta abierta en el panel de la derecha (O3), marcada en la lista. */
  selected?: string | null;
  /** Sin oferta elegida, la primera va destacada (ofertas-cel.png). */
  featuredFirst?: boolean;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 sm:gap-3">
      {rows.map((job, i) => (
        <li key={job.id}>
          <JobCard
            job={job}
            query={query}
            tour={tour && i === 0}
            selected={job.id === selected}
            featured={job.id === selected || (featuredFirst && selected === null && i === 0)}
            followUp={seguimiento?.get(job.id) ?? null}
          />
        </li>
      ))}
    </ul>
  );
}

/** Empresa y modalidad en una sola línea, sin repetir (R-13): lo que el aviso no dice no se escribe. */
function companyLine(job: JobListRow): string {
  const mod =
    job.modality && job.modality !== "desconocida" ? (MODALITY_LABELS[job.modality] ?? null) : null;
  const modText = mod ? mod.charAt(0).toUpperCase() + mod.slice(1) : null;
  return [job.company, modText].filter(Boolean).join(" · ");
}

/**
 * `query`: los filtros de la lista, para que el detalle sepa volver y calcular "siguiente" (JS-061).
 * `tour`: la primera tarjeta lleva las anclas de la guía de /jobs (ronda 92).
 *
 * La tarjeta dice: puesto, empresa, modalidad, sello con número, sueldo si el aviso lo publica y, de la
 * tabla de requisitos de la evaluación, la condición excluyente que no coincide (arriba) y hasta 2
 * cosas sin confirmar. Los botones: «Ver oferta», «Guardar» y «Descartar».
 */
function JobCard({
  job,
  query,
  tour,
  selected,
  featured,
  followUp,
}: {
  job: JobListRow;
  query: string;
  tour: boolean;
  selected: boolean;
  featured: boolean;
  followUp: ApplicationFollowUp | null;
}) {
  const anchor = (name: string) => (tour ? { "data-tour": name } : {});
  const discarded = job.status === "descartada";
  const excluding = job.requirements.excluding;
  const unconfirmed = job.evaluating ? null : sinConfirmarLine(job.requirements.unconfirmed);
  const salary = salaryLine(
    job.salaryMinUsd,
    job.salaryMaxUsd,
    job.salaryPeriod,
    job.salaryOriginal,
  );
  const detailHref = `/jobs/${job.id}${query}`;
  const goneText = job.goneFromSource
    ? job.poolSourceName
      ? llenarTexto(T.vigencia.yaNoFigura, { fuente: job.poolSourceName })
      : T.vigencia.yaNoFiguraSinFuente
    : null;
  return (
    <div
      data-testid="tarjeta-oferta"
      data-estado={discarded ? "descartada" : undefined}
      className={cardClasses({
        level: featured ? "featured" : "list",
        selected,
        pressable: true,
        padding: "none",
        // Descartada: fondo neutro y legible, sin tachar nada (R-20)
        surface: discarded ? "none" : "surface",
        className: cx(
          "relative flex flex-col gap-2.5",
          discarded && "bg-surface-muted",
          featured
            ? "py-3.5 pr-3 pl-3.5 sm:py-[18px] sm:pr-[18px] sm:pl-5"
            : "py-3.5 pr-3 pl-3.5 sm:py-4 sm:pr-4 sm:pl-[18px]",
        ),
      })}
    >
      {/* El link al detalle cubre toda la tarjeta; lo que se toca adentro va encima (z-10). Hasta
          `lg` va al detalle; desde `lg` abre la oferta en el panel de la derecha (O3, C9-9) */}
      <Link
        href={detailHref}
        className="absolute inset-0 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
        aria-label={llenarTexto(T.tarjeta.abrirDetalle, { titulo: job.title })}
      />
      <Link
        href={`/jobs${query ? `${query}&` : "?"}oferta=${job.id}`}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className="absolute inset-0 hidden rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:block"
        aria-label={llenarTexto(T.tarjeta.abrirDetalle, { titulo: job.title })}
      />

      {/* Condición excluyente que no coincide: arriba, con texto e ícono (nunca solo color) */}
      {excluding ? (
        <p
          data-testid="tarjeta-no-coincide"
          className="flex min-w-0 items-start gap-1.5 text-sm font-bold text-danger"
        >
          <Icon name="descartar" size={18} className="mt-px shrink-0" />
          <span className="line-clamp-2 break-words">{noCoincideLine(excluding)}</span>
        </p>
      ) : null}

      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p
            data-testid="tarjeta-titulo"
            className={cx(
              "font-display leading-[1.2] font-bold break-words text-fg",
              featured ? "text-base sm:text-[19px]" : "text-base sm:text-[17px]",
            )}
          >
            {job.title}
          </p>
          <p
            className="text-sm font-medium break-words text-fg-muted"
            data-testid="tarjeta-empresa"
          >
            {companyLine(job)}
          </p>
          {salary ? (
            <p className="text-sm font-semibold text-fg" data-testid="tarjeta-salario">
              {salary}
            </p>
          ) : null}
          {job.evaluating ? (
            <p className="text-sm font-semibold text-fg-muted">{T.tarjeta.leyendo}</p>
          ) : null}
          {unconfirmed ? (
            <p className="text-sm font-semibold text-fg-muted" data-testid="tarjeta-sin-confirmar">
              {unconfirmed}
            </p>
          ) : null}
          {goneText ? (
            <p
              data-testid="tarjeta-ya-no-figura"
              className="flex min-w-0 items-start gap-1.5 text-sm font-semibold text-fg-muted"
            >
              <Icon name="cruz" size={16} className="mt-px shrink-0" />
              <span className="break-words">{goneText}</span>
            </p>
          ) : null}
          {job.flags.includes("posible_duplicado") ? (
            <span className="self-start">
              <Chip tone="missing">Posible duplicado</Chip>
            </span>
          ) : null}
          {discarded || job.savedAt ? (
            <p className="flex flex-wrap items-center gap-1.5">
              {discarded ? (
                <span
                  data-testid="marca-descartada"
                  className="inline-flex items-center gap-1 rounded-pill border border-line-strong bg-surface px-2.5 py-0.5 text-xs font-bold text-fg"
                >
                  {T.descartadas.marca}
                </span>
              ) : null}
              {job.savedAt ? <SavedMark /> : null}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Seal
            score={job.score}
            preScore={job.preScore}
            pending={job.evaluating}
            size={featured ? "featured" : "list"}
            title={
              job.evaluating
                ? "Esperando la evaluación"
                : job.score === null && job.preScore !== null
                  ? PRE_SCORE_EXPLAIN
                  : undefined
            }
            {...anchor("jobs:puntaje")}
          />
        </div>
      </div>

      {/* Botones: encima del link que cubre la tarjeta (z-10) */}
      <div
        className="relative z-10 flex flex-wrap items-center gap-2"
        data-testid="tarjeta-acciones"
      >
        <Link
          href={detailHref}
          className={buttonClasses({ variant: discarded ? "secondary" : "primary", size: "sm" })}
        >
          {T.tarjeta.verOferta}
        </Link>
        {discarded ? (
          <form action={reviewAgainAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="back" value={query} />
            <Button type="submit" variant="secondary" size="sm" data-testid="volver-a-revisar">
              {T.descartadas.volverARevisar}
            </Button>
          </form>
        ) : (
          <>
            <SaveButton jobId={job.id} title={job.title} saved={job.savedAt !== null} />
            {/* Descartar es el evento `discard`, válido solo desde «evaluada» (transition()) */}
            {job.status === "evaluada" ? (
              <form action={discardJobAction}>
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="back" value={query} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  data-testid="descartar-oferta"
                  aria-label={`${T.tarjeta.descartar}: ${job.title}`}
                >
                  {T.tarjeta.descartar}
                </Button>
              </form>
            ) : null}
          </>
        )}
      </div>
      {followUp ? <SeguimientoPostulacion followUp={followUp} /> : null}
    </div>
  );
}
