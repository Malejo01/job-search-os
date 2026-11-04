import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Tarjeta base (N3-3; medidas de C10-2, `.card` y `.cardl` del tablero aprobado el 4/11): blanca
 * sobre el lavanda, radio 24.
 *
 * `level`:
 * - `flat` (por defecto): un panel que no se toca, sin borde.
 * - `list` (`.cardl`): borde de 2 px en `line` (#E4E4EA) y 4 px abajo. Las tarjetas de las listas
 *   y los recuadros («Para hacer hoy», el checklist del detalle).
 * - `featured` (`.card`): borde de 2 px en línea fuerte (#D4D4DC) y 6 px abajo. La destacada de la
 *   pantalla (la mejor de Hoy, el detalle, el formulario de /acceso).
 *
 * `selected` pasa el borde a índigo: la oferta elegida en la lista de la computadora.
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
  list: "border-x-2 border-t-2 edge-4 [--jso-edge-top:2px]",
  featured: "border-x-2 border-t-2 edge-6 [--jso-edge-top:2px]",
};

// El color va aparte: dos `border-*` de color en la misma clase no se resuelven por orden
const LEVEL_LINE: Record<CardLevel, string> = {
  flat: "",
  list: "border-line",
  featured: "border-line-strong",
};

const PADDING = { none: "", sm: "p-4", md: "p-5 sm:p-6" } as const;

type CardBase = HTMLAttributes<HTMLElement> & {
  tone?: CardTone;
  level?: CardLevel;
  pressable?: boolean;
  /** Borde índigo: la tarjeta elegida (lista y detalle lado a lado). */
  selected?: boolean;
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
  selected = false,
  padding = "sm",
  surface = "surface",
  className,
}: Pick<
  CardBase,
  "tone" | "level" | "pressable" | "selected" | "padding" | "surface" | "className"
> = {}): string {
  return cx(
    "rounded-card",
    TONES[tone],
    tone === "neutral" && LEVELS[level],
    tone === "neutral" && level !== "flat" && (selected ? "border-line-ink" : LEVEL_LINE[level]),
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
  selected,
  padding,
  surface,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag
      className={cardClasses({ tone, level, pressable, selected, padding, surface, className })}
      {...props}
    >
      {children}
    </Tag>
  );
}
