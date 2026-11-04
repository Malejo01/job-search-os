import { buildFitPoints, englishIsNotAGap, isEnglishGap } from "@job-search-os/pipeline";
import Link from "next/link";
import { OfferD3 } from "@/components/offer-d3";
import { buttonClasses, cardClasses } from "@/components/ui";
import type { JobDetail } from "@/lib/job-detail";
import { riskLabel, safeHttpUrl } from "@/lib/labels";
import { ApplyButton } from "./[id]/apply-button";
import { FitPointsPanel } from "./[id]/fit-points-panel";

/**
 * Ofertas en la computadora (O3, C9-9; D3 de C10-8, el panel derecho de ofertas-pc.png): el
 * detalle a la derecha de la lista, sin cambiar de página. La oferta elegida vive en la URL
 * (`?oferta=<id>`): anda el botón atrás y el enlace se puede compartir. Server Component. Solo
 * desde `lg`; en el celular y en la tablet tocar una oferta sigue yendo a `/jobs/[id]`.
 *
 * Sin checklist (evaluaciones viejas), debajo van los puntos a favor y en contra de siempre.
 */
export function OfferPanel({ job, detailHref }: { job: JobDetail; detailHref: string }) {
  const ev = job.evaluation;
  const jobUrl = safeHttpUrl(job.url);
  return (
    <aside
      aria-labelledby="panel-oferta-titulo"
      data-testid="panel-oferta"
      className="hidden min-w-0 flex-col gap-4 pb-4 lg:flex"
    >
      <OfferD3
        job={job}
        variant="panel"
        actions={
          <>
            {jobUrl ? (
              <ApplyButton jobId={job.id} url={jobUrl} canApply={job.events.includes("apply")} />
            ) : null}
            <Link href={detailHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Ver el detalle completo
            </Link>
          </>
        }
      />
      {!ev?.checklist && ev ? (
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
      ) : !ev && !job.evaluating ? (
        <p className="rounded-card bg-surface p-5 text-sm text-fg-muted">
          Todavía no la evaluamos: en el detalle completo podés pegar la descripción o pedir que la
          evaluemos.
        </p>
      ) : null}
    </aside>
  );
}

/** Sin oferta elegida: el lugar del panel con una indicación (y los atajos de siempre abajo). */
export function OfferPanelHint() {
  return (
    <p
      className={cardClasses({ level: "list", padding: "md", className: "text-sm text-fg-muted" })}
    >
      Tocá una oferta de la lista para ver acá sus requisitos y qué te falta, sin salir de la
      página.
    </p>
  );
}
