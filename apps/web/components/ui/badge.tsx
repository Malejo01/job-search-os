import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Badge (N3-3): estado, fuente, riesgo, contador. `soft` es fondo suave y texto del tono; `muted`,
 * un fondo un tono más fuerte para lo que tiene que resaltar en una lista (bloqueador, duplicado);
 * `strong` es relleno fuerte y texto blanco. `square` es el rectángulo chico de las listas; `pill`, el
 * redondo. El texto va adentro: el color nunca es la única señal.
 */
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const SOFT: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-fg-muted",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  brand: "bg-brand text-brand-contrast",
};

const MUTED: Record<BadgeTone, string> = {
  neutral: "bg-surface-strong text-fg",
  success: "bg-success-muted text-success",
  warning: "bg-warning-muted text-warning",
  danger: "bg-danger-muted text-danger",
  info: "bg-info-muted text-info",
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
  square: "rounded-badge px-1.5 py-0.5",
  pill: "rounded-pill px-2 py-0.5",
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
    "inline-flex items-center gap-1 text-xs font-medium",
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
