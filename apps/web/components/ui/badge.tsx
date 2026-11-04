import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Badge o etiqueta (N3-3, manual M8 en C7-4): estado, fuente, riesgo, contador. `soft` es la
 * etiqueta del manual (fondo enfático del estado y su texto); `muted` le suma un borde del estado,
 * para lo que tiene que resaltar en una lista (bloqueador, duplicado); `strong` es relleno fuerte y
 * texto blanco. Todas en semibold. `square` es el rectángulo de las listas (radio 6); `pill`, el
 * redondo. El texto va adentro: el color nunca es la única señal.
 *
 * C9-3: las dos formas quedan en píldora (`rounded-badge` vale 9999px). Un badge no se toca: no
 * lleva borde inferior. Para lo que se toca, `filterChipClasses`; para lo que tenés o te falta,
 * `Chip`.
 */
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

// Etiquetas del manual (M8): el fondo enfático del estado (`-muted`) con su texto. El lima de
// marca no es un estado: `brand` queda para la marca DEMO y contadores de acción.
const SOFT: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-fg-muted",
  success: "bg-success-muted text-success",
  warning: "bg-warning-muted text-warning",
  danger: "bg-danger-muted text-danger",
  info: "bg-info-muted text-info",
  brand: "bg-brand text-brand-contrast",
};

// Igual que `soft` con un borde del estado: para lo que tiene que resaltar en una lista
const MUTED: Record<BadgeTone, string> = {
  neutral: "bg-surface-strong text-fg",
  success: "bg-success-muted text-success ring-1 ring-inset ring-success-line",
  warning: "bg-warning-muted text-warning ring-1 ring-inset ring-warning-line",
  danger: "bg-danger-muted text-danger ring-1 ring-inset ring-danger-line",
  info: "bg-info-muted text-info ring-1 ring-inset ring-info-line",
  brand: "bg-brand text-brand-contrast",
};

const STRONG: Record<BadgeTone, string> = {
  neutral: "bg-surface-strong text-fg",
  success: "bg-success-strong text-on-strong",
  warning: "bg-warning-strong text-on-strong",
  danger: "bg-danger-strong text-on-strong",
  info: "bg-info-strong text-on-strong",
  brand: "bg-brand text-brand-contrast",
};

const EMPHASIS = { soft: SOFT, muted: MUTED, strong: STRONG } as const;

const SHAPES = {
  square: "rounded-badge px-2.5 py-0.5",
  pill: "rounded-pill px-2.5 py-0.5",
} as const;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  emphasis?: keyof typeof EMPHASIS;
  shape?: keyof typeof SHAPES;
  /**
   * Qué es, para quien no ve el color: «Puntaje», «Bloqueador». Va oculto antes del texto. Hace falta
   * cuando el texto solo no dice el estado (`<Badge tone="danger">3</Badge>`).
   */
  srLabel?: string;
  children: ReactNode;
};

export function badgeClasses({
  tone = "neutral",
  emphasis = "soft",
  shape = "pill",
  className,
}: Pick<BadgeProps, "tone" | "emphasis" | "shape" | "className"> = {}): string {
  return cx(
    "inline-flex items-center gap-1 text-xs font-bold",
    SHAPES[shape],
    EMPHASIS[emphasis][tone],
    className,
  );
}

export function Badge({
  tone,
  emphasis,
  shape,
  srLabel,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={badgeClasses({ tone, emphasis, shape, className })} {...props}>
      {srLabel ? <span className="sr-only">{`${srLabel}: `}</span> : null}
      {children}
    </span>
  );
}
