import { offerMetaLine, offerPlace } from "@job-search-os/pipeline";
import { OfferCard } from "@/components/offer-card";
import type { JobListRow } from "@/lib/jobs";

/**
 * Oferta de Hoy (C7-7; tarjeta K2 de C10-6): «La mejor de hoy» es la destacada (`featured`) y
 * «También para vos», de lista. Lo que tenés y lo que te falta en chips, la línea chica («4 a tu
 * favor, 1 te falta · Presencial · hace 2 días») y el sello con su frase para lectores de pantalla
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
      meta={offerMetaLine(job.modality, new Date(job.postedAt ?? job.firstSeenAt), now)}
      score={job.score}
      sealAs="text"
      featured={featured}
    />
  );
}
