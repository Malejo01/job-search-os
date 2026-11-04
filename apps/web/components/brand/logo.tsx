import { BRAND, BRAND_COLORS } from "@job-search-os/pipeline";
import type { CSSProperties } from "react";
import { cx } from "@/components/ui/cx";
import { BAR_MARK, MONOGRAM } from "./monogram";

/**
 * Logo de la marca (C7-2; logo B2 en C9-4). El único componente que dibuja la marca: un pedido de
 * Ani sobre el logo se resuelve acá y en los tokens `--jso-logo-*` de `globals.css`.
 *
 * Logo de las pantallas aprobadas el 4/11 (C10-2, `.logo` del tablero): el ícono (la «A» de un
 * trazo con el punto adentro) y el logotipo «AfinIA» en Bricolage Grotesque 800 y «Jobs» en 500,
 * tracking −0,03 em, sin punto final. Sobre índigo, la «A» y «AfinIA» lima, el punto y «Jobs»
 * blancos. El monograma B2 (la «A» rellena con el punto al pie) queda para el favicon y los íconos.
 *
 * - `variant`: `full` (ícono y logotipo: las barras y la cabecera), `wordmark` (solo el logotipo)
 *   o `mark` (el monograma B2).
 * - `tone`: el fondo sobre el que va. `auto` acompaña al modo claro u oscuro («AfinIA» índigo,
 *   «Jobs» y el punto en índigo vivo en claro; «AfinIA» y el punto lima, «Jobs» blanco en oscuro). `light`, `dark` y `accent` (sobre lima) son fijos: el
 *   header índigo lleva `dark` en los dos modos. Paleta «índigo y lima» del 3/11.
 * - Para lectores de pantalla es una imagen con el nombre (`BRAND.name`). Con `decorative`, se
 *   oculta (cuando al lado ya está escrito el nombre).
 *
 * Server Component, sin JS. Respeta la zona de seguridad del manual: no lleva padding propio, el
 * espacio alrededor lo da quien lo ubica.
 */
export type LogoVariant = "full" | "mark" | "wordmark";
export type LogoTone = "auto" | "light" | "dark" | "accent";
export type LogoSize = "sm" | "md" | "lg";

type ToneColors = { strong: string; light: string; mark: string; dot: string };

const TONES: Record<LogoTone, ToneColors> = {
  auto: {
    strong: "var(--jso-logo-strong)",
    light: "var(--jso-logo-light)",
    mark: "var(--jso-logo-mark)",
    dot: "var(--jso-logo-dot)",
  },
  light: {
    strong: BRAND_COLORS.ink,
    light: BRAND_COLORS.accentDeep,
    mark: BRAND_COLORS.ink,
    dot: BRAND_COLORS.accentDeep,
  },
  dark: {
    strong: BRAND_COLORS.accent,
    light: BRAND_COLORS.white,
    mark: BRAND_COLORS.accent,
    dot: BRAND_COLORS.accent,
  },
  accent: {
    strong: BRAND_COLORS.ink,
    light: BRAND_COLORS.accentDeep,
    mark: BRAND_COLORS.ink,
    dot: BRAND_COLORS.accentDeep,
  },
};

// Alto del monograma y tamaño de letra del logotipo. sm es el de las barras: 21 px en el celular y
// 26 desde `sm`, con el ícono de 24 y 30 px (1,15 em).
const SIZES: Record<LogoSize, { mark: number; text: string }> = {
  sm: { mark: 30, text: "text-[21px] sm:text-[26px]" },
  md: { mark: 40, text: "text-[32px]" },
  lg: { mark: 56, text: "text-[46px]" },
};

export function Monogram({
  size,
  tone = "auto",
  className,
}: {
  size: number;
  tone?: LogoTone;
  className?: string;
}) {
  const colors = TONES[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox={MONOGRAM.viewBox}
      aria-hidden="true"
      focusable="false"
      className={cx("shrink-0", className)}
    >
      <path d={MONOGRAM.path} fillRule="evenodd" style={{ fill: colors.mark }} />
      <circle {...MONOGRAM.dot} style={{ fill: colors.dot }} />
    </svg>
  );
}

/** Ícono de la barra: la «A» de un trazo (color fuerte) con el punto (color claro). */
function BarMark({ tone }: { tone: LogoTone }) {
  const colors = TONES[tone];
  return (
    <svg
      viewBox={BAR_MARK.viewBox}
      aria-hidden="true"
      focusable="false"
      className="size-[1.15em] shrink-0"
    >
      <path
        d={BAR_MARK.path}
        fill="none"
        strokeWidth={BAR_MARK.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: colors.strong }}
      />
      <circle {...BAR_MARK.dot} style={{ fill: colors.light }} />
    </svg>
  );
}

function Wordmark({ tone }: { tone: LogoTone }) {
  const colors = TONES[tone];
  const strong: CSSProperties = { color: colors.strong };
  const light: CSSProperties = { color: colors.light };
  return (
    <span
      aria-hidden="true"
      className="font-display leading-none tracking-[-0.03em] whitespace-nowrap"
    >
      <span className="font-extrabold" style={strong}>
        {BRAND.wordmark.strong}
      </span>
      <span className="font-medium" style={light}>
        {BRAND.wordmark.light}
      </span>
    </span>
  );
}

export function Logo({
  variant = "full",
  tone = "auto",
  size = "sm",
  decorative = false,
  className,
}: {
  variant?: LogoVariant;
  tone?: LogoTone;
  size?: LogoSize;
  decorative?: boolean;
  className?: string;
}) {
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": BRAND.name } as const);
  return (
    <span
      {...a11y}
      data-logo={variant}
      className={cx("inline-flex items-center gap-[0.3em]", SIZES[size].text, className)}
    >
      {variant === "mark" ? (
        <Monogram size={SIZES[size].mark} tone={tone} />
      ) : (
        <>
          {variant === "full" ? <BarMark tone={tone} /> : null}
          <Wordmark tone={tone} />
        </>
      )}
    </span>
  );
}
