import { BRAND, BRAND_COLORS } from "@job-search-os/pipeline";
import type { CSSProperties } from "react";
import { cx } from "@/components/ui/cx";
import { MONOGRAM } from "./monogram";

/**
 * Logo de la marca (C7-2, manual M2 y M3). El único componente que dibuja la marca: un pedido de
 * Ani sobre el logo se resuelve acá y en los tokens `--jso-logo-*` de `globals.css`.
 *
 * - `variant`: `full` (monograma + logotipo), `mark` (solo el monograma) o `wordmark` (solo el texto).
 * - `tone`: el fondo sobre el que va. `auto` acompaña al modo claro u oscuro (tinta y naranja
 *   profundo en claro; naranja y blanco en oscuro). `light`, `dark` y `orange` son fijos: el header
 *   tinta lleva `dark` en los dos modos.
 * - Para lectores de pantalla es una imagen con el nombre (`BRAND.name`). Con `decorative`, se
 *   oculta (cuando al lado ya está escrito el nombre).
 *
 * Server Component, sin JS. Respeta la zona de seguridad del manual: no lleva padding propio, el
 * espacio alrededor lo da quien lo ubica.
 */
export type LogoVariant = "full" | "mark" | "wordmark";
export type LogoTone = "auto" | "light" | "dark" | "orange";
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
    light: BRAND_COLORS.deepOrange,
    mark: BRAND_COLORS.ink,
    dot: BRAND_COLORS.orange,
  },
  dark: {
    strong: BRAND_COLORS.orange,
    light: BRAND_COLORS.white,
    mark: BRAND_COLORS.orange,
    dot: BRAND_COLORS.white,
  },
  orange: {
    strong: BRAND_COLORS.ink,
    light: BRAND_COLORS.white,
    mark: BRAND_COLORS.ink,
    dot: BRAND_COLORS.white,
  },
};

// Alto del monograma y tamaño de letra del logotipo. sm es el del header (P1: 30 px y 22 px).
const SIZES: Record<LogoSize, { mark: number; text: string }> = {
  sm: { mark: 30, text: "text-[22px]" },
  md: { mark: 40, text: "text-[30px]" },
  lg: { mark: 56, text: "text-[44px]" },
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
      <path
        d={MONOGRAM.path}
        fill="none"
        strokeWidth={MONOGRAM.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: colors.mark }}
      />
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
        "font-display leading-none tracking-[-0.04em] whitespace-nowrap",
        SIZES[size].text,
      )}
    >
      <span className="font-extrabold" style={strong}>
        {BRAND.wordmark.strong}
      </span>
      <span className="font-light" style={light}>
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
      className={cx("inline-flex items-center gap-[0.35em]", SIZES[size].text, className)}
    >
      {variant !== "wordmark" ? <Monogram size={SIZES[size].mark} tone={tone} /> : null}
      {variant !== "mark" ? <Wordmark tone={tone} size={size} /> : null}
    </span>
  );
}
