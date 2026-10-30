"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { Badge } from "@/components/ui";
import type { JobListRow } from "@/lib/jobs";
import {
  BLOCKER_LABEL,
  DEMO_BADGE_CLASSES,
  DEMO_MODEL,
  flagLabel,
  formatDate,
  formatScoreNumber,
  LOCATION_TONES,
  LOCATION_LABELS,
  PRE_SCORE_EXPLAIN,
  riskLabel,
  safeHttpUrl,
  SCORE_CLASSES,
  scoreTone,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import { CardVerdict } from "./card-verdict";

/**
 * Lista de ofertas como cards (JS-015). Client component únicamente por Framer Motion:
 * las transiciones cuando cambian los filtros. Los datos vienen ya resueltos del servidor.
 * Un riesgo se ve (chip ámbar), no frena; un bloqueador frena (chip rojo).
 */
export function JobList({ rows, query = "" }: { rows: JobListRow[]; query?: string }) {
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
              <JobCard job={job} query={query} tour={i === 0} />
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
  const tone = scoreTone(job.score);
  const url = safeHttpUrl(job.url);
  const anchor = (name: string) => (tour ? { "data-tour": name } : {});
  return (
    <div className="relative flex gap-3 rounded-card border border-line bg-surface p-3 hover:border-line-control">
      {/* El link al detalle cubre toda la card; el link a la oferta va encima (z-10) */}
      <Link
        href={`/jobs/${job.id}${query}`}
        className="absolute inset-0 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        aria-label={`Abrir el detalle de ${job.title}`}
      />
      {job.evaluating ? (
        <div
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-control border-2 border-info-line text-info"
          role="img"
          aria-label="en cola"
          title="Esperando la evaluación"
          {...anchor("jobs:puntaje")}
        >
          <span className="motion-safe:animate-pulse text-lg font-semibold leading-none">…</span>
          <span className="text-[10px] uppercase">score</span>
        </div>
      ) : job.score === null && job.preScore !== null ? (
        <div
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-control border-2 border-dashed border-line-control text-fg-muted"
          role="img"
          aria-label={`estimación previa ${job.preScore}`}
          title={PRE_SCORE_EXPLAIN}
          {...anchor("jobs:puntaje")}
        >
          <span className="text-lg font-semibold leading-none">
            {formatScoreNumber(job.preScore)}
          </span>
          <span className="text-[10px]">/10</span>
        </div>
      ) : (
        <div
          className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-control ring-1 ${SCORE_CLASSES[tone]}`}
          role="img"
          aria-label={job.score === null ? "sin evaluar" : `score ${job.score}`}
          {...anchor("jobs:puntaje")}
        >
          <span className="text-lg font-semibold leading-none">
            {job.score === null ? "–" : formatScoreNumber(job.score)}
          </span>
          <span className="text-[10px]">{job.score === null ? "score" : "/10"}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium text-fg">{job.title}</p>
        <p className="truncate text-xs text-fg-subtle">
          {job.company}
          {job.locationRaw ? ` · ${job.locationRaw}` : ""}
        </p>
        <div className="flex flex-wrap gap-1" {...anchor("jobs:etiquetas")}>
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
        <time className="text-xs text-fg-subtle" dateTime={job.firstSeenAt}>
          {formatDate(job.postedAt ?? job.firstSeenAt)}
        </time>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 inline-flex min-h-11 items-center rounded-control border border-line-strong px-2 py-1 text-xs text-fg-muted hover:border-line-control hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus sm:min-h-0"
            title="Abrir la publicación original en una pestaña nueva"
          >
            Ver oferta ↗
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
