"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { Badge, Icon, Seal } from "@/components/ui";
import type { JobListRow } from "@/lib/jobs";
import {
  BLOCKER_LABEL,
  DEMO_BADGE_CLASSES,
  DEMO_MODEL,
  flagLabel,
  formatDate,
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
 * Lista de ofertas como cards (JS-015). Client component únicamente por Framer Motion:
 * las transiciones cuando cambian los filtros. Los datos vienen ya resueltos del servidor.
 * Un riesgo se ve (chip ámbar), no frena; un bloqueador frena (chip rojo).
 */
export function JobList({
  rows,
  query = "",
  tour = true,
}: {
  rows: JobListRow[];
  query?: string;
  /** La primera tarjeta lleva las anclas de la guía; la segunda lista (lejanas) no. */
  tour?: boolean;
}) {
  const reduce = useReducedMotion();
  const shift = reduce ? 0 : 6;
  return (
    // reducedMotion="user": con «reducir movimiento» del sistema no hay desplazamientos, solo opacidad
    <MotionConfig reducedMotion="user">
      <motion.ul layout className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {rows.map((job, i) => (
            <motion.li
              key={job.id}
              layout
              initial={{ opacity: 0, y: shift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -shift }}
              transition={{
                duration: 0.2,
                delay: reduce ? 0 : Math.min(i * 0.03, 0.2),
              }}
            >
              <JobCard job={job} query={query} tour={tour && i === 0} />
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>
    </MotionConfig>
  );
}

/**
 * `query`: los filtros de la lista, para que el detalle sepa volver y calcular "siguiente" (JS-061).
 * `tour`: la primera tarjeta lleva las anclas de la guía de /jobs (ronda 92).
 */
function JobCard({ job, query, tour }: { job: JobListRow; query: string; tour: boolean }) {
  const url = safeHttpUrl(job.url);
  const anchor = (name: string) => (tour ? { "data-tour": name } : {});
  return (
    <div className="relative flex gap-3 rounded-card bg-surface p-3.5 transition-colors hover:border-line-control">
      {/* El link al detalle cubre toda la card; el link a la oferta va encima (z-10) */}
      <Link
        href={`/jobs/${job.id}${query}`}
        className="absolute inset-0 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-label={`Abrir el detalle de ${job.title}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-[15px] font-bold text-fg">{job.title}</p>
        <p className="truncate text-[13px] text-fg-subtle">
          {job.company}
          {job.locationRaw ? ` · ${job.locationRaw}` : ""}
        </p>
        {job.evaluating ? (
          <p className="text-xs font-semibold text-fg-muted">Leyendo la oferta contra tu perfil…</p>
        ) : null}
        {job.fit.favor || job.fit.falta ? (
          <div className="flex min-w-0 flex-col gap-0.5 text-xs" data-testid="tarjeta-fit">
            {job.fit.favor ? (
              <p
                className="flex min-w-0 items-start gap-1 text-fg-muted"
                title={job.fit.favor.text}
              >
                <Icon name="fortalezas" size={16} className="mt-px text-success" />
                <span className="line-clamp-2 break-words">A tu favor: {job.fit.favor.text}</span>
              </p>
            ) : null}
            {job.fit.falta ? (
              <p
                className="flex min-w-0 items-start gap-1 text-fg-muted"
                title={job.fit.falta.text}
              >
                <Icon
                  name={job.fit.falta.kind === "frena" ? "descartar" : "afinar"}
                  size={16}
                  className={`mt-px ${job.fit.falta.kind === "frena" ? "text-danger" : "text-warning"}`}
                />
                <span className="line-clamp-2 break-words">
                  {job.fit.falta.label}: {job.fit.falta.text}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5" {...anchor("jobs:etiquetas")}>
          {job.model === DEMO_MODEL ? (
            <span className={DEMO_BADGE_CLASSES} title="Evaluación falsa del modo demo, sin LLM">
              DEMO
            </span>
          ) : null}
          {job.evaluating ? (
            <Badge shape="square" tone="info" emphasis="muted">
              En cola
            </Badge>
          ) : (
            <Badge shape="square">{STATUS_LABELS[job.status] ?? job.status}</Badge>
          )}
          {job.sources.map((k) => (
            <Badge key={k} shape="square" tone="info">
              {SOURCE_LABELS[k] ?? k}
            </Badge>
          ))}
          {job.locationOk ? (
            <Badge shape="square" tone={LOCATION_TONES[job.locationOk] ?? "neutral"}>
              {LOCATION_LABELS[job.locationOk] ?? job.locationOk}
            </Badge>
          ) : null}
          {job.bloqueadores.length ? (
            <Badge shape="square" tone="danger" emphasis="muted">
              {job.bloqueadores.length === 1
                ? `${BLOCKER_LABEL}: 1 motivo`
                : `${BLOCKER_LABEL}: ${job.bloqueadores.length} motivos`}
            </Badge>
          ) : null}
          {job.riesgos.slice(0, 2).map((r) => (
            <Badge key={r} shape="square" tone="warning">
              Riesgo: {riskLabel(r)}
            </Badge>
          ))}
          {job.riesgos.length > 2 ? (
            <Badge shape="square" tone="warning">
              +{job.riesgos.length - 2} riesgos
            </Badge>
          ) : null}
          {job.flags.includes("posible_duplicado") ? (
            <Badge shape="square" tone="warning" emphasis="muted">
              Posible duplicado
            </Badge>
          ) : null}
          {job.flags.flatMap((f) => {
            const label = flagLabel(f);
            return label
              ? [
                  <Badge key={f} shape="square">
                    {label}
                  </Badge>,
                ]
              : [];
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
        <time className="text-xs font-semibold text-fg-subtle" dateTime={job.firstSeenAt}>
          {formatDate(job.postedAt ?? job.firstSeenAt)}
        </time>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 inline-flex min-h-11 items-center gap-1 rounded-control px-1 text-xs font-semibold text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
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
