/**
 * Geometría del monograma (manual M2): la «A» de trazo, sin travesaño, con el punto. Un solo lugar
 * para el logo de la app, el ícono, las imágenes OG y la vitrina de marca.
 */
export const MONOGRAM = {
  viewBox: "0 0 200 200",
  /** Trazo de la «A»: sin relleno, puntas y uniones redondeadas. */
  path: "M42 164 L100 36 L158 164",
  strokeWidth: 26,
  /** El punto, donde iría el travesaño. */
  dot: { cx: 100, cy: 126, r: 17 },
} as const;
