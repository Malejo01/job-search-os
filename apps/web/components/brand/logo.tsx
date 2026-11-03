import { BRAND, BRAND_COLORS } from "@job-search-os/pipeline";
import type { CSSProperties } from "react";
import { cx } from "@/components/ui/cx";
import { MONOGRAM } from "./monogram";

/**
 * Logo de la marca (C7-2; logo B2 en C9-4). El único componente que dibuja la marca: un pedido de
 * Ani sobre el logo se resuelve acá y en los tokens `--jso-logo-*` de `globals.css`.
 *
 * Logo B2: «AfinIA» en Bricolage Grotesque 800 y «Jobs» en 500, con el punto de la marca al final.
 * El monograma es la «A» de la misma fuente con el mismo punto (favicon, íconos, lugares chicos).
 *
 * - `variant`: `full` y `wordmark` (el logotipo con el punto; desde B2 son lo mismo: el monograma
 *   ya no acompaña al texto) o `mark` (solo el monograma).
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

// Alto del monograma y tamaño de letra del logotipo. sm es el del header (24 px).
const SIZES: Record<LogoSize, { mark: number; text: string }> = {
  sm: { mark: 30, text: "text-[24px]" },
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

function Wordmark({ tone, size }: { tone: LogoTone; size: LogoSize }) {
  const colors = TONES[tone];
  const strong: CSSProperties = { color: colors.strong };
  const light: CSSProperties = { color: colors.light };
  return (
    <span
      aria-hidden="true"
      className={cx(
        "font-display leading-none tracking-[-0.03em] whitespace-nowrap",
        SIZES[size].text,
      )}
    >
      <span className="font-extrabold" style={strong}>
        {BRAND.wordmark.strong}
      </span>
      <span className="font-medium" style={light}>
        {BRAND.wordmark.light}
      </span>
      {/* El punto de la marca: un círculo del color del punto, sobre la línea de base */}
      <span
        className="ml-[0.06em] inline-block size-[0.2em] rounded-pill align-baseline"
        style={{ backgroundColor: colors.dot }}
      />
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
      className={cx("inline-flex items-center gap-[0.35em]", SIZES[size].text, className)}
    >
      {variant === "mark" ? (
        <Monogram size={SIZES[size].mark} tone={tone} />
      ) : (
        <Wordmark tone={tone} size={size} />
      )}
    </span>
  );
}
