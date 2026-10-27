import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Botón base (N3-3). Server Component: sirve igual desde un client component. Para un `<Link>` o un
 * `<a>` con forma de botón, `buttonClasses()`; para un link dentro del texto, `textLinkClasses()`.
 *
 * `className` es para ubicarlo (`w-full`, `self-start`, `mt-2`), no para cambiarle el color, el
 * padding ni el tamaño: sin tailwind-merge dos clases que se pisan no se resuelven por orden de
 * escritura sino por orden de Tailwind. Si hace falta otra variante, se suma acá.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

// Las dos alturas mantienen 44 px: el tamaño táctil mínimo no depende de la variante
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 py-2 text-base",
  sm: "min-h-11 px-3 text-sm",
};

// `ghost` va sin padding lateral: se alinea con el texto de alrededor, como «Salir» o «Ahora no»
const GHOST_SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 text-base",
  sm: "min-h-11 text-sm",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-contrast hover:bg-brand-hover",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-surface-muted",
  ghost: "text-fg-muted underline-offset-2 hover:underline",
  danger: "bg-danger-strong text-on-strong hover:brightness-110",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cx(BASE, (variant === "ghost" ? GHOST_SIZES : SIZES)[size], VARIANTS[variant], className);
}

/** Link dentro del texto o al pie de una tarjeta. `block`: con 44 px de alto, para tocar solo. */
export function textLinkClasses({
  block = false,
  className,
}: { block?: boolean; className?: string } = {}): string {
  return cx(
    "font-medium text-link underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
    block && "inline-flex min-h-11 w-fit items-center",
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}
