import Link from "next/link";
import { offerMeta, offerPlace } from "@job-search-os/pipeline";
import { Badge, Chip, Icon, Seal } from "@/components/ui";
import type { JobListRow } from "@/lib/jobs";
import {
  BLOCKER_LABEL,
  DEMO_BADGE_CLASSES,
  DEMO_MODEL,
  flagLabel,
  LOCATION_TONES,
  LOCATION_LABELS,
  PRE_SCORE_EXPLAIN,
  riskLabel,
  safeHttpUrl,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import { CardVerdict } from "./card-verdict";

/**
 * Lista de ofertas (JS-015; tarjeta K2 en C9-8). Server Component: los datos vienen resueltos del
 * servidor y desde C9 no hay animación de entrada (decisión 13: nada entra escalonado). Lo único
 * que se mueve es el hundimiento de la tarjeta al tocarla (CSS).
 * Un riesgo se ve (chip ámbar), no frena; un bloqueador frena (línea roja).
 */
export function JobList({
  rows,
  query = "",
  tour = true,
  selected = null,
}: {
  rows: JobListRow[];
  query?: string;
  /** La primera tarjeta lleva las anclas de la guía; la segunda lista (lejanas) no. */
  tour?: boolean;
  /** La oferta abierta en el panel de la derecha (O3), marcada en la lista. */
  selected?: string | null;
}) {
  const now = new Date();
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((job, i) => (
        <li key={job.id}>
          <JobCard
            job={job}
            query={query}
            tour={tour && i === 0}
            now={now}
            selected={job.id === selected}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * `query`: los filtros de la lista, para que el detalle sepa volver y calcular "siguiente" (JS-061).
 * `tour`: la primera tarjeta lleva las anclas de la guía de /jobs (ronda 92).
 */
function JobCard({
  job,
  query,
  tour,
  now,
  selected,
}: {
  job: JobListRow;
  query: string;
  tour: boolean;
  now: Date;
  selected: boolean;
}) {
  const url = safeHttpUrl(job.url);
  const anchor = (name: string) => (tour ? { "data-tour": name } : {});
  const frena = job.fit.falta?.kind === "frena" ? job.fit.falta : null;
  return (
    <div
      className={`pressable edge-4 relative flex gap-3 rounded-card bg-surface p-4 sm:gap-4 sm:p-5 ${
        selected ? "border-x-2 border-t-2 border-brand-text" : "border-edge"
      }`}
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
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-display text-[17px] leading-snug font-bold break-words text-fg">
            {job.title}
          </p>
          <p className="text-sm break-words text-fg-muted">
            {offerPlace({
              company: job.company,
              location: job.locationRaw,
              modality: job.modality,
            })}
          </p>
        </div>
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
                {c.label}
              </Chip>
            ))}
            {job.card.more ? <Chip>{`y ${job.card.more} más`}</Chip> : null}
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
        {job.card.count ? (
          <p className="text-sm font-bold text-fg" data-testid="tarjeta-conteo">
            {job.card.count}
          </p>
        ) : null}
        <p className="text-xs text-fg-subtle">
          <time dateTime={job.postedAt ?? job.firstSeenAt}>
            {offerMeta(job.modality, new Date(job.postedAt ?? job.firstSeenAt), now)}
          </time>
        </p>
        <div className="flex flex-wrap gap-1.5" {...anchor("jobs:etiquetas")}>
          {job.model === DEMO_MODEL ? (
            <span className={DEMO_BADGE_CLASSES} title="Evaluación falsa del modo demo, sin LLM">
              DEMO
            </span>
          ) : null}
          {job.evaluating ? (
            <Badge tone="info" emphasis="muted">
              En cola
            </Badge>
          ) : (
            <Badge>{STATUS_LABELS[job.status] ?? job.status}</Badge>
          )}
          {job.sources.map((k) => (
            <Badge key={k} tone="info">
              {SOURCE_LABELS[k] ?? k}
            </Badge>
          ))}
          {job.locationOk ? (
            <Badge tone={LOCATION_TONES[job.locationOk] ?? "neutral"}>
              {LOCATION_LABELS[job.locationOk] ?? job.locationOk}
            </Badge>
          ) : null}
          {job.bloqueadores.length ? (
            <Badge tone="danger" emphasis="muted">
              {job.bloqueadores.length === 1
                ? `${BLOCKER_LABEL}: 1 motivo`
                : `${BLOCKER_LABEL}: ${job.bloqueadores.length} motivos`}
            </Badge>
          ) : null}
          {job.riesgos.slice(0, 2).map((r) => (
            <Badge key={r} tone="warning">
              Riesgo: {riskLabel(r)}
            </Badge>
          ))}
          {job.riesgos.length > 2 ? (
            <Badge tone="warning">+{job.riesgos.length - 2} riesgos</Badge>
          ) : null}
          {job.flags.includes("posible_duplicado") ? (
            <Badge tone="warning" emphasis="muted">
              Posible duplicado
            </Badge>
          ) : null}
          {job.flags.flatMap((f) => {
            const label = flagLabel(f);
            return label ? [<Badge key={f}>{label}</Badge>] : [];
          })}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Seal
          score={job.score}
          preScore={job.preScore}
          pending={job.evaluating}
          title={
            job.evaluating
              ? "Esperando la evaluación"
              : job.score === null && job.preScore !== null
                ? PRE_SCORE_EXPLAIN
                : undefined
          }
          {...anchor("jobs:puntaje")}
        />
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 inline-flex min-h-11 items-center gap-1 rounded-pill px-1 text-xs font-bold text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            title="Abrir la publicación original en una pestaña nueva"
          >
            Ver oferta
            <Icon name="abrirAviso" size={14} />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : null}
        {job.evaluationId && !job.evaluating ? (
          <CardVerdict
            jobId={job.id}
            evaluationId={job.evaluationId}
            verdict={job.humanVerdict}
            {...(tour ? { tourAnchor: "jobs:opinion" } : {})}
          />
        ) : null}
      </div>
    </div>
  );
}
