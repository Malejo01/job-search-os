import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

/**
 * Chips (C9-3, decisiones 5 y 8 de C9). Dos usos:
 *
 * - `Chip`: una etiqueta con ícono y texto que dice algo de la oferta: lo que tenés (`have`,
 *   verde, con check), lo que te falta (`missing`, ámbar, con un más: es un paso para sumar) o algo
 *   neutro. El ícono y el texto van siempre: el color nunca es la única señal. No se toca.
 * - `filterChipClasses`: un chip o filtro que se toca (`<button>`, `<Link>`): píldora blanca con
 *   borde inferior de 4 px que se hunde; el elegido va en lima con borde índigo (es uno de los tres
 *   lugares de la lima). Quien lo usa pone `aria-pressed` o `aria-current`.
 */
export type ChipTone = "have" | "missing" | "neutral";

const TONES: Record<ChipTone, { box: string; icon: IconName | null }> = {
  have: { box: "bg-success-muted text-success", icon: "check" },
  missing: { box: "bg-warning-muted text-warning", icon: "sumar" },
  neutral: { box: "bg-surface-muted text-fg-muted", icon: null },
};

export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ChipTone;
  /** Otro ícono que el del tono (o `null` para ninguno). */
  icon?: IconName | null;
  /** Qué es, para quien no ve el color ni el ícono: «Tenés», «Te falta». Va oculto antes. */
  srLabel?: string;
  children: ReactNode;
};

export function chipClasses({
  tone = "neutral",
  className,
}: { tone?: ChipTone; className?: string } = {}): string {
  return cx(
    "inline-flex min-h-7 max-w-full items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold",
    TONES[tone].box,
    className,
  );
}

export function Chip({
  tone = "neutral",
  icon,
  srLabel,
  className,
  children,
  ...props
}: ChipProps) {
  const name = icon === undefined ? TONES[tone].icon : icon;
  return (
    <span className={chipClasses({ tone, className })} {...props}>
      {name ? <Icon name={name} size={14} className="shrink-0" /> : null}
      {srLabel ? <span className="sr-only">{`${srLabel}: `}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function filterChipClasses({
  selected = false,
  className,
}: { selected?: boolean; className?: string } = {}): string {
  return cx(
    "pressable edge-4 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pill border-x-2 border-t-2 px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    selected
      ? "border-brand-contrast bg-brand text-brand-contrast"
      : "border-edge bg-surface text-fg hover:bg-surface-muted",
    className,
  );
}
