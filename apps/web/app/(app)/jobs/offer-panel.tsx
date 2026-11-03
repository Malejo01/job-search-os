import {
  buildFitPoints,
  closenessPhrase,
  englishIsNotAGap,
  isEnglishGap,
  offerAge,
  offerPlace,
  withCurrentSkillLevels,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { SealStamp } from "@/components/motion/seal-stamp";
import { RequisitosDelAviso } from "@/components/requisitos-del-aviso";
import { buttonClasses, Icon, Seal, textLinkClasses } from "@/components/ui";
import type { JobDetail } from "@/lib/job-detail";
import { MODALITY_LABELS, riskLabel, safeHttpUrl } from "@/lib/labels";
import { FitPointsPanel } from "./[id]/fit-points-panel";

/**
 * Ofertas en la computadora (O3, C9-9, decisión 11): el detalle D3 a la derecha de la lista, sin
 * cambiar de página. La oferta elegida vive en la URL (`?oferta=<id>`): anda el botón atrás y el
 * enlace se puede compartir. Server Component: se arma en el servidor con `getJobDetail`. Solo
 * desde `lg`; en el celular y en la tablet tocar una oferta sigue yendo a `/jobs/[id]`.
 */
export function OfferPanel({ job, detailHref }: { job: JobDetail; detailHref: string }) {
  const ev = job.evaluation;
  const jobUrl = safeHttpUrl(job.url);
  const levels = new Map(
    Object.entries(job.skillInfo).flatMap(([slug, info]) =>
      info.level === null ? [] : [[slug, info.level] as const],
    ),
  );
  const checklist = ev?.checklist ? withCurrentSkillLevels(ev.checklist, levels) : null;
  const closeness = checklist ? closenessPhrase(checklist) : null;
  const pending = job.evaluating && !ev;
  const modality =
    job.modality && job.modality !== "desconocida"
      ? (MODALITY_LABELS[job.modality] ?? job.modality)
      : null;
  return (
    <aside
      aria-labelledby="panel-oferta-titulo"
      data-testid="panel-oferta"
      className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-[460px] shrink-0 flex-col gap-4 overflow-y-auto pb-4 lg:flex"
    >
      <div className="edge-6 flex flex-col gap-4 rounded-card border-edge bg-surface p-5">
        <div className="flex gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="panel-oferta-titulo" className="text-xl leading-tight font-bold break-words">
              {job.title}
            </h2>
            <p className="text-sm text-fg-muted">
              {offerPlace({
                company: job.company,
                location: job.locationRaw,
                modality: job.modality,
              })}
            </p>
            <p className="text-xs text-fg-subtle">
              {modality ? `${modality}. ` : ""}
              {offerAge(new Date(job.postedAt ?? job.firstSeenAt), new Date())}
            </p>
          </div>
          <SealStamp jobId={job.id} evaluated={Boolean(ev)}>
            <Seal score={ev ? ev.score : null} pending={pending} size="detail" />
          </SealStamp>
        </div>
        {closeness ? <p className="text-base font-semibold text-fg">{closeness}</p> : null}
        {pending ? (
          <p className="text-base font-semibold text-fg-muted">
            Leyendo la oferta contra tu perfil…
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Link href={detailHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Ver el detalle completo
          </Link>
          {jobUrl ? (
            <a
              href={jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={textLinkClasses({ block: true, className: "gap-1 text-sm" })}
            >
              Ver el aviso
              <Icon name="abrirAviso" size={14} />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          ) : null}
        </div>
      </div>
      {checklist ? (
        <RequisitosDelAviso
          checklist={checklist}
          modal={{ jobId: job.id, skillInfo: job.skillInfo }}
          rebuilt={ev?.checklistRebuilt ?? false}
        />
      ) : ev ? (
        <FitPointsPanel
          headingLevel={3}
          stacked
          points={buildFitPoints({
            matchFuerte: ev.matchFuerte,
            senales: ev.senales,
            gaps: englishIsNotAGap(job.jdText, null)
              ? ev.gaps.filter((g) => !isEnglishGap(g))
              : ev.gaps,
            riesgos: ev.riesgos.map(riskLabel),
            bloqueadores: ev.bloqueadores,
            checklist: null,
          })}
          limited
        />
      ) : (
        <p className="rounded-card bg-surface p-5 text-sm text-fg-muted">
          Todavía no la evaluamos: en el detalle completo podés pegar la descripción o pedir que la
          evaluemos.
        </p>
      )}
    </aside>
  );
}

/** Sin oferta elegida: el lugar del panel con una indicación (y los atajos de siempre abajo). */
export function OfferPanelHint() {
  return (
    <p className="rounded-card bg-surface p-5 text-sm text-fg-muted">
      Tocá una oferta de la lista para ver acá sus requisitos y qué te falta, sin salir de la
      página.
    </p>
  );
}
