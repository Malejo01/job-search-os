import type { SVGProps } from "react";

/**
 * Íconos de la marca (C7-4, manual M6): grilla de 24 px, trazo de 2 px, puntas redondeadas, sin
 * relleno. Toman el color del texto (`currentColor`).
 *
 * Accesibilidad: sin `label` son decorativos (`aria-hidden`) y el texto de al lado dice qué es; con
 * `label`, son una imagen con ese nombre. Un ícono solo (sin texto) siempre lleva `label`, y el
 * botón o link que lo contiene, 44 px de área táctil.
 */
export const ICON_PATHS = {
  ofertas:
    "M5 7h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2 M3 13h18",
  score: "M4 17a8 8 0 1116 0 M12 17l4-5",
  perfil: "M12 4a4 4 0 100 8 4 4 0 000-8z M4 21a8 8 0 0116 0",
  alertas: "M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z M3 8l9 6 9-6",
  cv: "M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6",
  fortalezas: "M3 17l6-6 4 4 8-8 M15 7h6v6",
  pegar:
    "M8 5H6a1 1 0 00-1 1v14a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1h-2 M9 3h6v4H9z M9 12h6 M9 16h4",
  descartar: "M12 3a9 9 0 100 18 9 9 0 000-18z M9 9l6 6 M15 9l-6 6",
  abrirAviso: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
  filtro: "M4 5h16l-6 7v6l-4 2v-8z",
  hoy: "M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2",
  afinar: "M4 8h6 M14 8h6 M10 5h4v6h-4z M4 16h10 M18 16h2 M14 13h4v6h-4z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  /** Tamaño en px (ancho y alto). 20 en texto chico, 24 por defecto. */
  size?: number;
  /** Nombre accesible. Sin él, el ícono es decorativo. */
  label?: string;
};

export function Icon({ name, size = 24, label, className, ...props }: IconProps) {
  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true } as const);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      {...a11y}
      {...props}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
