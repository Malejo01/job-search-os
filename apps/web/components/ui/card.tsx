import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Tarjeta base (N3-3, forma P1 en C9-3): blanca sobre el lavanda, radio 24, sin borde lateral.
 *
 * `level` (decisión 5 de C9):
 * - `flat` (por defecto): un panel que no se toca, sin borde.
 * - `list`: una tarjeta de lista que se toca, con borde inferior de 4 px.
 * - `featured`: la tarjeta destacada de la pantalla (la oferta principal de Hoy, el detalle), con
 *   borde inferior de 6 px. Una por pantalla.
 *
 * `pressable` le suma el hundimiento de 3 px al tocarla (solo si toda la tarjeta lleva a algún
 * lado). `surface="none"` deja ver el fondo de la página. `tone` es para un panel con significado
 * (éxito, riesgo…); para un aviso de una línea, `Alert`.
 */
export type CardTone = "neutral" | "success" | "warning" | "danger" | "info";
export type CardLevel = "flat" | "list" | "featured";

const TONES: Record<CardTone, string> = {
  neutral: "",
  success: "border border-success-line bg-success-soft",
  warning: "border border-warning-line bg-warning-soft",
  danger: "border border-danger-line bg-danger-soft",
  info: "border border-info-line bg-info-soft",
};

const LEVELS: Record<CardLevel, string> = {
  flat: "",
  list: "edge-4 border-edge",
  featured: "edge-6 border-edge",
};

const PADDING = { none: "", sm: "p-4", md: "p-5 sm:p-6" } as const;

type CardBase = HTMLAttributes<HTMLElement> & {
  tone?: CardTone;
  level?: CardLevel;
  pressable?: boolean;
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
  level = "flat",
  pressable = false,
  padding = "sm",
  surface = "surface",
  className,
}: Pick<
  CardBase,
  "tone" | "level" | "pressable" | "padding" | "surface" | "className"
> = {}): string {
  return cx(
    "rounded-card",
    TONES[tone],
    tone === "neutral" && LEVELS[level],
    tone === "neutral" && (surface === "surface" ? "bg-surface" : "border border-line"),
    pressable && "pressable",
    PADDING[padding],
    className,
  );
}

export function Card({
  as: Tag = "div",
  tone,
  level,
  pressable,
  padding,
  surface,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag
      className={cardClasses({ tone, level, pressable, padding, surface, className })}
      {...props}
    >
      {children}
    </Tag>
  );
}
