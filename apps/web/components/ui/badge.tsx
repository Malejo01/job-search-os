import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Badge (N3-3): estado, fuente, riesgo, contador. `soft` es fondo suave y texto del tono; `strong`
 * es relleno fuerte y texto blanco. `square` es el rectángulo chico de las listas; `pill`, el
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

const STRONG: Record<BadgeTone, string> = {
  neutral: "bg-surface-strong text-fg",
  success: "bg-success-strong text-on-strong",
  warning: "bg-warning-strong text-on-strong",
  danger: "bg-danger-strong text-on-strong",
  info: "bg-info-strong text-on-strong",
  brand: "bg-brand text-brand-contrast",
};

const SHAPES = {
  square: "rounded-badge px-1.5 py-0.5",
  pill: "rounded-pill px-2 py-0.5",
} as const;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  emphasis?: "soft" | "strong";
  shape?: keyof typeof SHAPES;
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
    (emphasis === "strong" ? STRONG : SOFT)[tone],
    className,
  );
}

export function Badge({ tone, emphasis, shape, className, children, ...props }: BadgeProps) {
  return (
    <span className={badgeClasses({ tone, emphasis, shape, className })} {...props}>
      {children}
    </span>
  );
}
