import { offerAge, offerPlace } from "@job-search-os/pipeline";
import { OfferCard } from "@/components/offer-card";
import { Badge } from "@/components/ui";
import type { JobListRow } from "@/lib/jobs";
import { ACTION_LABELS, MODALITY_LABELS } from "@/lib/labels";

/**
 * Fila de «Lo nuevo» (C7-7; tarjeta K2 en C9-10): la primera es la oferta destacada de Hoy
 * (`featured`, borde inferior de 6 px y sello grande) y el resto van en lista. Lo que tenés y lo
 * que te falta en chips, la acción sugerida y el sello con su frase para lectores de pantalla
 * («Puntaje 9 de 10, muy afín»). Un solo link cubre toda la tarjeta. Server Component.
 */
export function NewJobRow({
  job,
  featured = false,
  now,
}: {
  job: JobListRow;
  featured?: boolean;
  now: Date;
}) {
  const action = job.accion ? (ACTION_LABELS[job.accion] ?? null) : null;
  const modality =
    job.modality && job.modality !== "desconocida"
      ? (MODALITY_LABELS[job.modality] ?? job.modality)
      : null;
  return (
    <OfferCard
      testId="hoy-nuevo-fila"
      href={`/jobs/${job.id}`}
      title={job.title}
      place={offerPlace({
        company: job.company,
        location: job.locationRaw,
        modality: job.modality,
      })}
      chips={job.card.chips}
      more={job.card.more}
      count={job.card.count}
      meta={`${modality ? `${modality}. ` : ""}${offerAge(new Date(job.postedAt ?? job.firstSeenAt), now)}`}
      score={job.score}
      sealAs="text"
      featured={featured}
      aside={action ? <Badge>{action}</Badge> : null}
    />
  );
}
