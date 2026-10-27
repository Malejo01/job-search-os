import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Tarjeta base (N3-3): borde, radio y padding. `surface="none"` deja ver el fondo de la página, como
 * las tarjetas de /hoy y /encaje antes de los tokens; migrarlas con `"surface"` las volvería blancas.
 * `tone` es para un panel con significado (éxito, riesgo…); para un aviso de una línea, `Alert`.
 */
export type CardTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONES: Record<CardTone, string> = {
  neutral: "border-line",
  success: "border-success-line bg-success-soft",
  warning: "border-warning-line bg-warning-soft",
  danger: "border-danger-line bg-danger-soft",
  info: "border-info-line bg-info-soft",
};

const PADDING = { none: "", sm: "p-3", md: "p-4" } as const;

type CardBase = HTMLAttributes<HTMLElement> & {
  tone?: CardTone;
  padding?: keyof typeof PADDING;
  surface?: "surface" | "none";
  children: ReactNode;
};

/**
 * `section` y `aside` son regiones: sin nombre, el lector de pantalla anuncia una región anónima.
 * Por eso piden `aria-labelledby` (el id del título) o `aria-label`. `li` va dentro de un `ul`/`ol`.
 */
export type CardProps = CardBase &
  (
    | { as?: "div" | "li" | "article" }
    | { as: "section" | "aside"; "aria-labelledby": string }
    | { as: "section" | "aside"; "aria-label": string }
  );

export function cardClasses({
  tone = "neutral",
  padding = "sm",
  surface = "surface",
  className,
}: Pick<CardBase, "tone" | "padding" | "surface" | "className"> = {}): string {
  return cx(
    "rounded-card border",
    TONES[tone],
    tone === "neutral" && surface === "surface" && "bg-surface",
    PADDING[padding],
    className,
  );
}

export function Card({
  as: Tag = "div",
  tone,
  padding,
  surface,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag className={cardClasses({ tone, padding, surface, className })} {...props}>
      {children}
    </Tag>
  );
}
