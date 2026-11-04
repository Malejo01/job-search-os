import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Botón base (N3-3, forma P1 en C9-3). Server Component: sirve igual desde un client component.
 * Para un `<Link>` o un `<a>` con forma de botón, `buttonClasses()`; para un link dentro del texto,
 * `textLinkClasses()`.
 *
 * Forma (C10-2, `.btn` y `.btn2` del tablero aprobado el 4/11): píldora, plano, texto 800, con un
 * borde inferior de 5 px un tono más oscuro que el relleno (la «sombra interior» de la referencia);
 * al tocarlo se hunde 3 px (`pressable`, CSS puro) sin cambiar de alto. `md` mide 54 px (acciones
 * principales), `lg` 56 (la portada y /acceso) y `sm` 44 (barras, tarjetas).
 *
 * `className` es para ubicarlo (`w-full`, `self-start`, `mt-2`), no para cambiarle el color, el
 * padding ni el tamaño: sin tailwind-merge dos clases que se pisan no se resuelven por orden de
 * escritura sino por orden de Tailwind. Si hace falta otra variante, se suma acá.
 */
export type ButtonVariant = "primary" | "secondary" | "dark" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex min-w-11 items-center justify-center gap-2 rounded-pill text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

// Deshabilitado (manual M8): borde gris, fondo de superficie y texto apagado, en vez de opacidad.
// Va con `disabled:` y `aria-disabled:`, que Tailwind escribe después de los colores de la variante.
const DISABLED =
  "disabled:border-line-strong disabled:bg-surface disabled:text-fg-subtle aria-disabled:border-line-strong aria-disabled:bg-surface aria-disabled:text-fg-subtle";

// Las dos alturas mantienen 44 px: el tamaño táctil mínimo no depende de la variante
const SIZES: Record<ButtonSize, string> = {
  lg: "min-h-14 px-7 text-[17px] edge-5",
  md: "min-h-[54px] px-7 text-base edge-5",
  sm: "min-h-11 px-[18px] text-sm edge-5",
};

// `ghost` va sin padding lateral ni borde: se alinea con el texto de alrededor, como «Salir»
const GHOST_SIZES: Record<ButtonSize, string> = {
  lg: "min-h-11 text-base",
  md: "min-h-11 text-base",
  sm: "min-h-11 text-sm",
};

/**
 * - `primary`: la acción principal, lima con texto índigo y borde inferior #8FB82E. Es uno de los
 *   tres lugares donde va la lima (decisión 2): uno por pantalla o por tarjeta.
 * - `secondary`: blanco con borde índigo de 2 px y 5 px abajo (`.btn2`).
 * - `dark`: relleno del color del texto («Guardar y evaluar»); en oscuro se invierte solo.
 * - `ghost`: como un link, sin borde.
 * - `danger`: borrar o salir de algo que no vuelve.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "pressable border-x-0 border-t-0 border-edge-brand bg-brand font-extrabold text-brand-contrast hover:bg-brand-hover",
  secondary:
    "pressable border-x-2 border-t-2 border-line-ink bg-surface font-extrabold text-fg [--jso-edge-top:2px] hover:bg-surface-muted",
  dark: "pressable border-x-0 border-t-0 border-edge-ink bg-fg font-extrabold text-canvas hover:bg-fg-muted",
  ghost: "font-bold text-fg-muted underline-offset-2 hover:underline",
  danger:
    "pressable border-x-0 border-t-0 border-[color-mix(in_srgb,var(--jso-danger-strong),black_35%)] bg-danger-strong font-extrabold text-on-strong hover:brightness-110",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cx(
    BASE,
    (variant === "ghost" ? GHOST_SIZES : SIZES)[size],
    VARIANTS[variant],
    variant === "ghost" ? "disabled:text-fg-subtle aria-disabled:text-fg-subtle" : DISABLED,
    className,
  );
}

/** Link dentro del texto o al pie de una tarjeta. `block`: con 44 px de alto, para tocar solo. */
export function textLinkClasses({
  block = false,
  className,
}: { block?: boolean; className?: string } = {}): string {
  return cx(
    "font-semibold text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
    block && "inline-flex min-h-11 w-fit items-center",
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * `disabled` saca el botón del Tab. `aria-disabled` lo deja enfocable (para que se lea por qué no
 * se puede) y acá también lo bloquea: sin esto el estilo dice «deshabilitado» pero el clic anda.
 */
export function Button({
  variant,
  size,
  className,
  type = "button",
  onClick,
  ...props
}: ButtonProps) {
  const blocked = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <button
      type={blocked ? "button" : type}
      onClick={blocked ? undefined : onClick}
      className={buttonClasses({ variant, size, className })}
      {...props}
    />
  );
}
