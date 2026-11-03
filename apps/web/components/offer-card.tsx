import type { OfferChip } from "@job-search-os/pipeline";
import Link from "next/link";
import type { ReactNode } from "react";
import { Chip, cx, Seal } from "@/components/ui";

/**
 * Tarjeta de oferta K2 (C9-8, decisión 8 de C9). Server Component.
 *
 * - El puesto en Bricolage 700 y, abajo, la empresa y el lugar dichos en una frase (`place`, de
 *   `offerPlace` en pipeline: «Estudio Ruiz y Asociados, en Salta»), sin separadores «·».
 * - Chips: lo que tenés (verde) y lo que te falta (ámbar), como mucho tres y «y 2 más», siempre con
 *   ícono y texto (`offerCardChips` en pipeline).
 * - La línea de conteo («4 a tu favor, 1 te falta»), solo si la evaluación tiene checklist.
 * - Modalidad y antigüedad en texto chico (`meta`).
 * - El sello a la derecha.
 *
 * `featured`: la tarjeta destacada de la pantalla (la oferta principal de Hoy), con borde inferior
 * de 6 px y sello grande; las demás, 4 px. Toda la tarjeta lleva al detalle (`href`) con un link
 * que la cubre; lo que va en `aside` y `children` queda encima (`relative z-10`).
 */
export function OfferCard({
  href,
  title,
  place,
  chips = [],
  more = 0,
  count = null,
  meta,
  score,
  preScore = null,
  pending = false,
  sealTitle,
  sealAs,
  featured = false,
  aside,
  children,
  className,
  testId,
  sealProps,
  as: Tag = "li",
}: {
  href: string;
  title: string;
  place: string;
  chips?: readonly OfferChip[];
  more?: number;
  count?: string | null;
  /** Texto chico: modalidad y antigüedad («Remoto. Publicada hace 3 días»). */
  meta?: ReactNode;
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
  sealTitle?: string;
  /** `text`: el sello con su frase para lectores de pantalla adentro (Hoy). */
  sealAs?: "img" | "text";
  featured?: boolean;
  /** Debajo del sello: «Ver oferta», 👍/👎. */
  aside?: ReactNode;
  /** Debajo de los chips: una línea de por qué, acciones. */
  children?: ReactNode;
  className?: string;
  testId?: string;
  /** Atributos extra para el sello (anclas de la guía). */
  sealProps?: { [key: `data-${string}`]: string | undefined };
  as?: "li" | "div" | "article";
}) {
  return (
    <Tag
      data-testid={testId}
      className={cx(
        "pressable relative flex gap-3 rounded-card border-edge bg-surface sm:gap-4",
        featured ? "edge-6 p-5 sm:p-6" : "edge-4 p-4 sm:p-5",
        className,
      )}
    >
      <Link
        href={href}
        className="absolute inset-0 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-label={`Abrir el detalle de ${title}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p
            className={cx(
              "font-display leading-snug font-bold break-words text-fg",
              featured ? "text-xl" : "text-[17px]",
            )}
          >
            {title}
          </p>
          <p className="text-sm break-words text-fg-muted">{place}</p>
        </div>
        {pending ? (
          <p className="text-sm font-semibold text-fg-muted">Leyendo la oferta contra tu perfil…</p>
        ) : null}
        {chips.length ? (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {chips.map((c) => (
              <Chip
                key={`${c.tone}-${c.label}`}
                tone={c.tone}
                srLabel={c.tone === "have" ? "Tenés" : "Te falta"}
                title={c.label}
              >
                {c.label}
              </Chip>
            ))}
            {more ? <Chip>{`y ${more} más`}</Chip> : null}
          </div>
        ) : null}
        {count ? <p className="text-sm font-bold text-fg">{count}</p> : null}
        {children ? (
          <div className="relative z-10 flex min-w-0 flex-col gap-1">{children}</div>
        ) : null}
        {meta ? <p className="text-xs text-fg-subtle">{meta}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Seal
          score={score}
          preScore={preScore}
          pending={pending}
          title={sealTitle}
          as={sealAs}
          size={featured ? "detail" : "list"}
          {...sealProps}
        />
        {aside ? (
          <div className="relative z-10 flex flex-col items-end gap-1 text-xs text-fg-subtle">
            {aside}
          </div>
        ) : null}
      </div>
    </Tag>
  );
}
