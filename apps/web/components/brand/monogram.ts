/**
 * Geometría del monograma (logo B2, C9-4): la «A» de Bricolage Grotesque 800 con el punto de la
 * marca a su derecha, sobre la línea de base. El trazo de la «A» sale del glifo de la fuente
 * (`assets/fonts/bricolage-800.woff`, 1000 unidades por em) con el eje Y dado vuelta para SVG. Un
 * solo lugar para el logo de la app, el ícono, las imágenes OG y la vitrina de marca.
 */
export const MONOGRAM = {
  viewBox: "0 0 960 820",
  /** La «A» rellena, con su contraforma (`fill-rule: evenodd`). */
  path: "M14 740L238 80H474L698 740H522L485 616H227L190 740ZM453 508L364 206H348L259 508Z",
  /** El punto de la marca, al pie de la «A», donde termina el logotipo. */
  dot: { cx: 840, cy: 664, r: 96 },
} as const;

/**
 * Ícono de la barra (C10-2, `.logo` del tablero aprobado el 4/11): la «A» de un solo trazo
 * redondeado con el punto adentro. Va antes del logotipo en las barras índigo y en la cabecera.
 * El favicon y los íconos de la app siguen con `MONOGRAM` (logo B2).
 */
export const BAR_MARK = {
  viewBox: "0 0 200 200",
  /** Trazo de la «A», sin relleno, 26 de ancho con puntas y uniones redondas. */
  path: "M42 164 L100 36 L158 164",
  strokeWidth: 26,
  dot: { cx: 100, cy: 126, r: 17 },
} as const;
