import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

/**
 * Chips (C9-3, decisiones 5 y 8 de C9). Dos usos:
 *
 * - `Chip` (`.ok` y `.fa` del tablero aprobado, C10-2): una etiqueta que dice algo de la oferta:
 *   lo que tenés (`have`, verde con «✓») o lo que te falta (`missing`, ámbar con «!»), 12 px 700,
 *   píldora de 4×10. El signo y el texto van siempre: el color nunca es la única señal. No se toca.
 * - `filterChipClasses` (`.chip` y `.chipon`): un chip o filtro que se toca (`<button>`,
 *   `<Link>`): píldora blanca con borde de 2 px y 4 abajo que se hunde, 13 px 700; el elegido va en
 *   lima con borde índigo (uno de los tres lugares de la lima). Mide 38 px como la referencia, y el
 *   área que se toca llega a 44 con un margen invisible. Quien lo usa pone `aria-pressed` o
 *   `aria-current`.
 */
export type ChipTone = "have" | "missing" | "neutral";

const TONES: Record<ChipTone, { box: string; sign: string | null }> = {
  have: { box: "bg-success-soft text-success", sign: "✓" },
  missing: { box: "bg-warning-soft text-warning", sign: "!" },
  neutral: { box: "bg-surface-muted text-fg-muted", sign: null },
};

export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ChipTone;
  /** Un ícono en vez del signo del tono (o `null` para ninguno). */
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
    "inline-flex max-w-full items-center gap-1 rounded-pill px-2.5 py-1 text-xs leading-[1.2] font-bold",
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
  const sign = icon === undefined ? TONES[tone].sign : null;
  return (
    <span className={chipClasses({ tone, className })} {...props}>
      {icon ? <Icon name={icon} size={14} className="shrink-0" /> : null}
      {sign ? (
        <span aria-hidden="true" className="shrink-0">
          {sign}
        </span>
      ) : null}
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
    "pressable edge-4 relative inline-flex items-center justify-center gap-1.5 rounded-pill border-x-2 border-t-2 px-3.5 py-2 [--jso-edge-top:2px] text-[13px] leading-[1.2] font-bold whitespace-nowrap before:absolute before:inset-x-0 before:-inset-y-[3px] before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    selected
      ? "border-brand-contrast bg-brand text-brand-contrast"
      : "border-line-strong bg-surface text-fg hover:bg-surface-muted",
    className,
  );
}
