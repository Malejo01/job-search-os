import { attributionFor, type ShowcaseCard } from "@job-search-os/pipeline";
import Link from "next/link";
import { safeHttpUrl } from "@/lib/labels";

/**
 * Tarjeta de una oferta de muestra (ronda 63): título, empresa, ubicación, modalidad, skills,
 * fecha y la fuente con link al aviso original (solo http/https, validado con `safeHttpUrl`).
 * Sin la descripción. `data-modality` lo usa el filtro del cliente. Server Component.
 */
export const MODALITY_LABELS: Record<string, string> = {
  remoto: "Remoto",
  hibrido: "Híbrido",
  presencial: "Presencial",
  desconocida: "Modalidad no informada",
};

const DATE_FORMAT = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function modalityKey(value: string | null): string {
  return value && value in MODALITY_LABELS ? value : "desconocida";
}

export function JobCard({ card }: { card: ShowcaseCard }) {
  const modality = modalityKey(card.modality);
  const attribution = attributionFor(card.sourceKind, { company: card.company });
  const url = safeHttpUrl(card.sourceUrl);
  return (
    <li
      data-modality={modality}
      data-testid="showcase-card"
      className="min-w-0 rounded-card border border-line bg-surface p-4"
    >
      <article className="flex min-w-0 flex-col gap-2">
        <h3 className="break-words text-base font-semibold text-fg">{card.title}</h3>
        <p className="break-words text-sm text-fg">
          {card.company}
          {card.location ? ` · ${card.location}` : ""}
        </p>
        <p className="text-xs text-fg-subtle">
          {MODALITY_LABELS[modality]} · {DATE_FORMAT.format(new Date(card.publishedAt))}
        </p>
        {card.skills.length ? (
          <ul aria-label="Skills" className="flex flex-wrap gap-1">
            {card.skills.map((name) => (
              <li
                key={name}
                className="rounded border border-line-strong px-2 py-0.5 text-xs text-fg"
              >
                {name}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-fg-subtle">
          {attribution ? attribution.text : null}
          {url ? (
            <>
              {attribution ? " · " : null}
              {/* Sin nofollow ni noreferrer: Remote OK exige un link seguible (ver SourceAttribution) */}
              <a
                href={url}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center text-fg-muted underline underline-offset-2 hover:text-fg"
              >
                Ver el aviso original ↗
              </a>
            </>
          ) : null}
        </p>
        <p className="text-xs">
          <Link
            href="/acceso"
            className="inline-flex min-h-11 items-center text-fg-muted underline underline-offset-2 hover:text-fg"
          >
            ¿Qué tan bien te calza? Pedí acceso
          </Link>
        </p>
      </article>
    </li>
  );
}
