import Link from "next/link";
import { offerMetaLine, offerPlace } from "@job-search-os/pipeline";
import { cardClasses, Chip, cx, Icon, Seal } from "@/components/ui";
import type { JobListRow } from "@/lib/jobs";
import { PRE_SCORE_EXPLAIN } from "@/lib/labels";

/**
 * Lista de ofertas (JS-015; tarjeta K2 de los tableros aprobados en C10-7). Server Component, sin
 * animación de entrada (decisión 13). Lo único que se mueve es el hundimiento al tocar (CSS).
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
}: {
  rows: JobListRow[];
  query?: string;
  /** La primera tarjeta lleva las anclas de la guía; la segunda lista (lejanas) no. */
  tour?: boolean;
  /** La oferta abierta en el panel de la derecha (O3), marcada en la lista. */
  selected?: string | null;
  /** Sin oferta elegida, la primera va destacada (ofertas-cel.png). */
  featuredFirst?: boolean;
}) {
  const now = new Date();
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 sm:gap-3">
      {rows.map((job, i) => (
        <li key={job.id}>
          <JobCard
            job={job}
            query={query}
            tour={tour && i === 0}
            now={now}
            selected={job.id === selected}
            featured={job.id === selected || (featuredFirst && selected === null && i === 0)}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * `query`: los filtros de la lista, para que el detalle sepa volver y calcular "siguiente" (JS-061).
 * `tour`: la primera tarjeta lleva las anclas de la guía de /jobs (ronda 92).
 *
 * La tarjeta dice lo del tablero: puesto, empresa y lugar en una frase, chips, la línea chica y el
 * sello. Lo único que se suma es lo que frena la postulación (línea roja) y el «Leyendo…» mientras
 * se evalúa. Las etiquetas (fuente, estado, ubicación, riesgos), «Ver oferta» y 👍/👎 están en el
 * detalle (C10-7).
 */
function JobCard({
  job,
  query,
  tour,
  now,
  selected,
  featured,
}: {
  job: JobListRow;
  query: string;
  tour: boolean;
  now: Date;
  selected: boolean;
  featured: boolean;
}) {
  const anchor = (name: string) => (tour ? { "data-tour": name } : {});
  const frena = job.fit.falta?.kind === "frena" ? job.fit.falta : null;
  const small = [
    job.card.count,
    offerMetaLine(job.modality, new Date(job.postedAt ?? job.firstSeenAt), now),
  ].filter(Boolean);
  return (
    <div
      data-testid="tarjeta-oferta"
      className={cardClasses({
        level: featured ? "featured" : "list",
        selected,
        pressable: true,
        padding: "none",
        className: cx(
          "relative flex items-start gap-3",
          featured
            ? "py-3.5 pr-3 pl-3.5 sm:py-[18px] sm:pr-[18px] sm:pl-5"
            : "py-3.5 pr-3 pl-3.5 sm:py-4 sm:pr-4 sm:pl-[18px]",
        ),
      })}
    >
      {/* El link al detalle cubre toda la tarjeta; lo que se toca adentro va encima (z-10). Hasta
          `lg` va al detalle; desde `lg` abre la oferta en el panel de la derecha (O3, C9-9) */}
      <Link
        href={`/jobs/${job.id}${query}`}
        className="absolute inset-0 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
        aria-label={`Abrir el detalle de ${job.title}`}
      />
      <Link
        href={`/jobs${query ? `${query}&` : "?"}oferta=${job.id}`}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className="absolute inset-0 hidden rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:block"
        aria-label={`Abrir el detalle de ${job.title}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p
          className={cx(
            "font-display leading-[1.2] font-bold break-words text-fg",
            featured ? "text-base sm:text-[19px]" : "text-base sm:text-[17px]",
          )}
        >
          {job.title}
        </p>
        <p className="text-[13px] font-medium break-words text-fg-subtle">
          {offerPlace({ company: job.company, location: job.locationRaw, modality: job.modality })}
        </p>
        {job.evaluating ? (
          <p className="text-sm font-semibold text-fg-muted">Leyendo la oferta contra tu perfil…</p>
        ) : null}
        {job.card.chips.length ? (
          <div className="flex min-w-0 flex-wrap gap-1.5" data-testid="tarjeta-chips">
            {job.card.chips.map((c) => (
              <Chip
                key={`${c.tone}-${c.label}`}
                tone={c.tone}
                srLabel={c.tone === "have" ? "Tenés" : "Te falta"}
                title={c.label}
              >
                {c.tone === "missing" ? (
                  <span aria-hidden="true" className="hidden sm:inline">
                    Te falta:{" "}
                  </span>
                ) : null}
                {c.label}
              </Chip>
            ))}
          </div>
        ) : null}
        {frena ? (
          <p className="flex min-w-0 items-start gap-1 text-sm font-semibold text-danger">
            <Icon name="descartar" size={18} className="mt-px" />
            <span className="line-clamp-2 break-words">
              {frena.label}: {frena.text}
            </span>
          </p>
        ) : null}
        {/* Conteo, modalidad y antigüedad: una línea chica (en el celular no va, ofertas-cel.png) */}
        <p className="hidden text-xs font-semibold text-fg-subtle sm:block">
          <span data-testid="tarjeta-conteo">{small.join(" · ")}</span>
        </p>
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
  );
}
