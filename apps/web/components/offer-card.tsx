import type { OfferChip } from "@job-search-os/pipeline";
import Link from "next/link";
import type { ReactNode } from "react";
import { cardClasses, Chip, cx, Seal } from "@/components/ui";

/**
 * Tarjeta de oferta K2 (C9-8; medidas de C10, tarjetas de los tableros aprobados el 4/11). Server
 * Component.
 *
 * - El puesto en Bricolage 700 (19 px la destacada, 17 las de lista, 16 en el celular) y, abajo, la
 *   empresa y el lugar dichos en una frase (`place`: «Estudio Ruiz y Asociados, en Salta»), 13 px.
 * - Chips: lo que tenés («✓», verde) y lo que te falta («!», ámbar, «Te falta: …» desde `sm`).
 * - Una línea chica (12 px 600) con el conteo y lo que va en `meta`, separados por «·»: «4 a tu
 *   favor, 1 te falta · Presencial · hace 2 días».
 * - El sello a la derecha, alineado arriba.
 *
 * `featured`: la destacada de la pantalla (`.card`, 6 px abajo, sello 60/72); las demás, `.cardl`
 * (4 px, sello 56/62). `selected`: la oferta abierta al lado, con borde índigo. Con `href`, toda la
 * tarjeta lleva al detalle con un link que la cubre (y se hunde al tocarla); lo que va en `aside` y
 * `children` queda encima (`relative z-10`). Sin `href` es una muestra que no se toca (portada).
 */
export function OfferCard({
  href,
  title,
  place,
  chips = [],
  count = null,
  meta,
  score,
  preScore = null,
  pending = false,
  sealTitle,
  sealAs,
  featured = false,
  selected = false,
  aside,
  children,
  className,
  testId,
  sealProps,
  as: Tag = "li",
}: {
  href?: string;
  title: string;
  place: string;
  chips?: readonly OfferChip[];
  /** Ya no se muestra: el conteo dice cuántos hay. Queda por compatibilidad. */
  more?: number;
  count?: string | null;
  /** Texto chico después del conteo: modalidad y antigüedad («Presencial · hace 2 días»). */
  meta?: ReactNode;
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
  sealTitle?: string;
  /** `text`: el sello con su frase para lectores de pantalla adentro (Hoy). */
  sealAs?: "img" | "text";
  featured?: boolean;
  selected?: boolean;
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
  const small = [count, meta].filter((part) => part !== null && part !== undefined && part !== "");
  return (
    <Tag
      data-testid={testId}
      className={cardClasses({
        level: featured ? "featured" : "list",
        selected,
        pressable: Boolean(href),
        padding: "none",
        className: cx(
          "relative flex items-start gap-3",
          featured
            ? "py-3.5 pr-3 pl-3.5 sm:py-[18px] sm:pr-[18px] sm:pl-5"
            : "py-3.5 pr-3 pl-3.5 sm:py-4 sm:pr-4 sm:pl-[18px]",
          className,
        ),
      })}
    >
      {href ? (
        <Link
          href={href}
          className="absolute inset-0 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label={`Abrir el detalle de ${title}`}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p
          className={cx(
            "font-display leading-[1.2] font-bold break-words text-fg",
            featured ? "text-base sm:text-[19px]" : "text-base sm:text-[17px]",
          )}
        >
          {title}
        </p>
        <p className="text-[13px] font-medium break-words text-fg-subtle">{place}</p>
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
                {c.tone === "missing" ? (
                  <span aria-hidden="true" className="hidden sm:inline">
                    Te falta:{" "}
                  </span>
                ) : null}
                {c.label}
              </Chip>
            ))}
          </div>
        ) : null}
        {children ? (
          <div className="relative z-10 flex min-w-0 flex-col gap-1">{children}</div>
        ) : null}
        {small.length ? (
          // En el celular las tarjetas no llevan la línea chica (hoy-cel.png, ofertas-cel.png)
          <p className="hidden text-xs font-semibold text-fg-subtle sm:block">
            {small.map((part, i) => (
              <span key={i}>
                {i > 0 ? " · " : null}
                {part}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Seal
          score={score}
          preScore={preScore}
          pending={pending}
          title={sealTitle}
          as={sealAs}
          size={featured ? "featured" : "list"}
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
