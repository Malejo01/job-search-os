"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import type { JobListRow } from "@/lib/jobs";
import {
  DEMO_BADGE_CLASSES,
  DEMO_MODEL,
  formatDate,
  LOCATION_CLASSES,
  LOCATION_LABELS,
  SCORE_CLASSES,
  scoreTone,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";

/**
 * Lista de ofertas como cards (JS-015). Client component únicamente por Framer Motion:
 * las transiciones cuando cambian los filtros. Los datos vienen ya resueltos del servidor.
 * Un riesgo se ve (chip ámbar), no frena; un bloqueador frena (chip rojo).
 */
export function JobList({ rows }: { rows: JobListRow[] }) {
  return (
    <motion.ul layout className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {rows.map((job) => (
          <motion.li
            key={job.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <JobCard job={job} />
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}

function JobCard({ job }: { job: JobListRow }) {
  const tone = scoreTone(job.score);
  return (
    <div className="relative flex gap-3 rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-400">
      {/* El link al detalle cubre toda la card; el link a la oferta va encima (z-10) */}
      <Link
        href={`/jobs/${job.id}`}
        className="absolute inset-0 rounded-lg"
        aria-label={`Abrir el detalle de ${job.title}`}
      />
      {job.evaluating ? (
        <div
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md border-2 border-sky-300 text-sky-700"
          aria-label="evaluando"
          title="El modelo está evaluando esta oferta; la lista se actualiza sola"
        >
          <span className="animate-pulse text-lg font-semibold leading-none">…</span>
          <span className="text-[10px] uppercase">score</span>
        </div>
      ) : job.score === null && job.preScore !== null ? (
        <div
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md border-2 border-dashed border-zinc-400 text-zinc-700"
          aria-label={`pre-score ${job.preScore}`}
          title="Pre-score determinista, sin LLM: skills × tu nivel, riesgos del prefiltro y salario"
        >
          <span className="text-lg font-semibold leading-none">
            {job.preScore.toFixed(job.preScore % 1 ? 1 : 0)}
          </span>
          <span className="text-[10px] uppercase">pre</span>
        </div>
      ) : (
        <div
          className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md ring-1 ${SCORE_CLASSES[tone]}`}
          aria-label={job.score === null ? "sin evaluar" : `score ${job.score}`}
        >
          <span className="text-lg font-semibold leading-none">
            {job.score === null ? "–" : job.score.toFixed(job.score % 1 ? 1 : 0)}
          </span>
          <span className="text-[10px] uppercase">score</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium text-zinc-900">{job.title}</p>
        <p className="truncate text-xs text-zinc-600">
          {job.company}
          {job.locationRaw ? ` · ${job.locationRaw}` : ""}
        </p>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {job.model === DEMO_MODEL ? (
            <span className={DEMO_BADGE_CLASSES} title="Evaluación falsa del modo demo, sin LLM">
              DEMO
            </span>
          ) : null}
          {job.evaluating ? (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800">
              Evaluando…
            </span>
          ) : (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">
              {STATUS_LABELS[job.status] ?? job.status}
            </span>
          )}
          {job.sources.map((k) => (
            <span key={k} className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">
              {SOURCE_LABELS[k] ?? k}
            </span>
          ))}
          {job.locationOk ? (
            <span className={`rounded px-1.5 py-0.5 ${LOCATION_CLASSES[job.locationOk] ?? ""}`}>
              {LOCATION_LABELS[job.locationOk] ?? job.locationOk}
            </span>
          ) : null}
          {job.bloqueadores.length ? (
            <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">
              {job.bloqueadores.length === 1
                ? "1 bloqueador"
                : `${job.bloqueadores.length} bloqueadores`}
            </span>
          ) : null}
          {job.riesgos.slice(0, 2).map((r) => (
            <span key={r} className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">
              riesgo: {r}
            </span>
          ))}
          {job.riesgos.length > 2 ? (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">
              +{job.riesgos.length - 2} riesgos
            </span>
          ) : null}
          {job.flags
            .filter((f) => !f.startsWith("title_cap:"))
            .map((f) => (
              <span key={f} className="rounded bg-zinc-50 px-1.5 py-0.5 text-zinc-500">
                {f.replace("domain_keyword:", "dominio: ")}
              </span>
            ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <time className="text-[11px] text-zinc-400" dateTime={job.firstSeenAt}>
          {formatDate(job.postedAt ?? job.firstSeenAt)}
        </time>
        {job.url ? (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:border-zinc-500 hover:text-zinc-900"
            title="Abrir la publicación original en una pestaña nueva"
          >
            Ver oferta ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
