import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, type BadgeTone, cx, Seal } from "@/components/ui";

/**
 * Tarjeta de oferta (C7-4, manual M8 y P1): score, título, empresa y lugar, etiquetas de estado y,
 * a la derecha, la fecha y lo que se pueda hacer (abrir el aviso). Server Component.
 *
 * Toda la tarjeta lleva al detalle (`href`) con un link que la cubre; lo que va en `aside` y
 * `children` queda encima (`relative z-10`) para que sus propios links y botones se puedan tocar.
 */
export type OfferTag = { label: string; tone?: BadgeTone; srLabel?: string };

export function OfferCard({
  href,
  title,
  meta,
  score,
  preScore = null,
  pending = false,
  scoreTitle,
  tags = [],
  aside,
  children,
  className,
  testId,
  scoreProps,
}: {
  href: string;
  title: string;
  /** Empresa, lugar, modalidad: se unen con « · ». Los vacíos se saltean. */
  meta: Array<string | null | undefined>;
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
  scoreTitle?: string;
  tags?: OfferTag[];
  /** Columna derecha: fecha, «abrir el aviso». */
  aside?: ReactNode;
  /** Debajo de las etiquetas: a tu favor / te falta, acciones. */
  children?: ReactNode;
  className?: string;
  testId?: string;
  /** Atributos extra para la caja del score (anclas de la guía). */
  scoreProps?: { [key: `data-${string}`]: string | undefined };
}) {
  const metaText = meta.filter(Boolean).join(" · ");
  return (
    <li
      data-testid={testId}
      className={cx(
        "relative flex gap-3 rounded-card bg-surface p-3.5 transition-colors hover:border-line-control",
        className,
      )}
    >
      <Link
        href={href}
        className="absolute inset-0 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-label={`Abrir el detalle de ${title}`}
      />
      <Seal
        score={score}
        preScore={preScore}
        pending={pending}
        title={scoreTitle}
        {...scoreProps}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-[15px] font-bold text-fg">{title}</p>
        {metaText ? <p className="truncate text-[13px] text-fg-subtle">{metaText}</p> : null}
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge
                key={tag.label}
                shape="square"
                tone={tag.tone ?? "neutral"}
                srLabel={tag.srLabel}
                className="text-[11px]"
              >
                {tag.label}
              </Badge>
            ))}
          </div>
        ) : null}
        {children ? (
          <div className="relative z-10 flex min-w-0 flex-col gap-1">{children}</div>
        ) : null}
      </div>
      {aside ? (
        <div className="relative z-10 flex shrink-0 flex-col items-end gap-1 text-xs text-fg-subtle">
          {aside}
        </div>
      ) : null}
    </li>
  );
}
