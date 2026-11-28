/**
 * Regla de legibilidad (R30-12; plan R30 a R34 §9; tokens en `app/globals.css` y `docs/ux/legibilidad.md`).
 * Función pura que lee el código fuente de un componente y devuelve lo que no cumple:
 *
 * - `tamano_menor_12`: un tamaño de texto arbitrario debajo de 12 px (`text-[11px]`, `text-[0.6rem]`, un
 *   `fontSize` en línea). Las clases de la escala (`text-xs` 12, `text-sm` 14, `text-base` 16…) y los tokens
 *   (`text-meta`, `text-secondary`, `text-body`) pasan.
 * - `color_fuera_de_lista`: un color de texto que no es un token (`text-zinc-500`, `text-white`, `text-[#333]`).
 *   La lista permitida es `COLORES_DE_TEXTO`.
 * - `texto_transparente`: un color de texto con transparencia (`text-fg/70`).
 * - `opacidad`: `opacity-NN` (menos de 100) en un elemento: baja el contraste de todo el texto que lleva adentro.
 *
 * No ejecuta nada y no lee archivos: recibe el texto. El test `test/legibilidad.test.ts` la corre sobre las pantallas y
 * el script de auditoría (`e2e/340-*`) mide lo que se ve de verdad.
 */

export type CodigoLegibilidad =
  "tamano_menor_12" | "color_fuera_de_lista" | "texto_transparente" | "opacidad";

export type HallazgoLegibilidad = {
  codigo: CodigoLegibilidad;
  /** Línea (desde 1) del archivo. */
  linea: number;
  /** El fragmento que no cumple, sin más contexto. */
  fragmento: string;
};

/** Tamaño mínimo de un texto, en px. */
export const TAMANO_MINIMO_PX = 12;

/**
 * Colores de texto permitidos: los tres de la jerarquía (primario `fg`, secundario `fg-muted`, terciario o
 * deshabilitado `fg-subtle`), los de acción y estado, y los que dependen del fondo (sobre índigo, sobre relleno
 * fuerte, sobre lima). Lo demás falla.
 */
export const COLORES_DE_TEXTO: ReadonlySet<string> = new Set([
  "fg",
  "fg-muted",
  "fg-subtle",
  "link",
  "link-hover",
  "brand-text",
  "brand-contrast",
  // Texto sobre un fondo de marca: lima (`brand`), índigo (`ink`) o el fondo de la página (`canvas`) sobre un relleno
  "brand",
  "ink",
  "canvas",
  "on-ink",
  "on-ink-muted",
  "on-strong",
  "success",
  "warning",
  "danger",
  "info",
  "seal-line",
  "logo-strong",
  "logo-light",
  "logo-mark",
  "logo-dot",
  "current",
  "inherit",
  "transparent",
]);

/** Lo que va después de `text-` y no es un color: tamaños, alineación, corte de línea y desborde. */
const NO_ES_COLOR: ReadonlySet<string> = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
  "title",
  "heading",
  "meta",
  "secondary",
  "body",
  "left",
  "center",
  "right",
  "justify",
  "start",
  "end",
  "wrap",
  "nowrap",
  "balance",
  "pretty",
  "ellipsis",
  "clip",
]);

const SIZE_ARBITRARY = /(?<![\w-])text-\[(\d+(?:\.\d+)?)(px|rem|em)\]/g;
const TEXT_CLASS = /(?<![\w-])text-((?:\[[^\]\s]*\])|(?:[a-z0-9]+(?:-[a-z0-9]+)*))(\/\d+)?/g;
const OPACITY = /(?<![\w-])opacity-(\d+)(?![\w-])/g;
const INLINE_FONT_SIZE = /\bfont-?[sS]ize\s*:\s*['"]?(\d+(?:\.\d+)?)(px)?['"]?/g;

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function toPx(value: number, unit: string): number {
  return unit === "px" ? value : value * 16;
}

/** Lo que no cumple la regla de legibilidad en el texto de un archivo `.tsx`. */
export function auditarLegibilidad(source: string): HallazgoLegibilidad[] {
  const out: HallazgoLegibilidad[] = [];
  const add = (codigo: CodigoLegibilidad, index: number, fragmento: string) =>
    out.push({ codigo, linea: lineOf(source, index), fragmento });

  for (const m of source.matchAll(SIZE_ARBITRARY)) {
    if (toPx(Number(m[1]), m[2]!) < TAMANO_MINIMO_PX) add("tamano_menor_12", m.index, m[0]);
  }

  for (const m of source.matchAll(INLINE_FONT_SIZE)) {
    // Un `fontSize` sin unidad en React son px; con `rem` o `em` no se mide acá
    if (m[2] === "px" || m[2] === undefined) {
      if (Number(m[1]) < TAMANO_MINIMO_PX) add("tamano_menor_12", m.index, m[0]);
    }
  }

  for (const m of source.matchAll(TEXT_CLASS)) {
    const name = m[1]!;
    const alpha = m[2];
    if (name.startsWith("[")) {
      // `text-[13px]` es un tamaño (se mide arriba); cualquier otro corchete es un color suelto
      if (!/^\[\d+(?:\.\d+)?(?:px|rem|em)\]$/.test(name))
        add("color_fuera_de_lista", m.index, m[0]);
      continue;
    }
    if (NO_ES_COLOR.has(name)) continue;
    if (!COLORES_DE_TEXTO.has(name)) {
      add("color_fuera_de_lista", m.index, m[0]);
      continue;
    }
    if (alpha) add("texto_transparente", m.index, m[0]);
  }

  for (const m of source.matchAll(OPACITY)) {
    // `opacity-0` oculta el elemento (un campo trampa, el estado inicial de una transición): no hay texto que leer
    if (Number(m[1]) < 100 && Number(m[1]) !== 0) add("opacidad", m.index, m[0]);
  }

  return out.sort((a, b) => a.linea - b.linea);
}
