import Image from "next/image";
import { cx } from "./cx";

/**
 * Ilustración de marca (estilo E2, serie de Gemini). Guía de uso: `ilustraciones.md`, junto al manual de marca en docs/ux.
 *
 * - `frame: "lavender"`: la imagen tiene fondo lavanda y va dentro de un recuadro `#EEEDF9` con radio
 *   de 32 px, igual en claro y en oscuro (token `illustration`), así su fondo se funde con el recuadro.
 * - `frame: "ink"`: la imagen tiene fondo índigo y va directo sobre un bloque `bg-ink` (que es el mismo
 *   en los dos modos), sin recuadro.
 * - Siempre decorativa (`alt=""`): el texto de al lado ya dice lo que pasa. Una por pantalla como
 *   máximo, nunca en listas ni en tarjetas. Sin animación.
 * - Los dos archivos de cada escena (`x.webp` 600 × 448 y `x@2x.webp` 1200 × 896) salen en el
 *   `srcSet` por `lib/illustration-loader.ts`.
 *
 * Server Component. En `global-error.tsx` no se usa: ahí no hay Tailwind (ver ese archivo).
 */
export const ILLUSTRATION_SCENES = {
  hoy: "ink",
  acceso: "ink",
  bienvenida: "lavender",
  cv: "lavender",
  "sin-descripcion": "lavender",
  vacio: "lavender",
  postulaciones: "lavender",
  error: "lavender",
} as const;

export type IllustrationScene = keyof typeof ILLUSTRATION_SCENES;

/** Medidas de los archivos (4:3). La imagen se achica con CSS; `width` y `height` evitan el salto de layout. */
export const ILLUSTRATION_WIDTH = 600;
export const ILLUSTRATION_HEIGHT = 448;

/** Ancho máximo en pantalla: 224, 288 y 384 px. Siempre se achica si el contenedor es más angosto. */
const SIZES = { sm: "max-w-56", md: "max-w-72", lg: "max-w-sm" } as const;
export type IllustrationSize = keyof typeof SIZES;

export type IllustrationProps = {
  scene: IllustrationScene;
  size?: IllustrationSize;
  /** Carga de inmediato la que está arriba del todo y se ve al abrir la pantalla. */
  priority?: boolean;
  className?: string;
};

export function Illustration({
  scene,
  size = "md",
  priority = false,
  className,
}: IllustrationProps) {
  const image = (
    <Image
      src={`/ilustraciones/${scene}.webp`}
      alt=""
      width={ILLUSTRATION_WIDTH}
      height={ILLUSTRATION_HEIGHT}
      priority={priority}
      className="block h-auto w-full"
    />
  );
  if (ILLUSTRATION_SCENES[scene] === "ink") {
    return (
      <div data-illustration={scene} className={cx("w-full", SIZES[size], className)}>
        {image}
      </div>
    );
  }
  return (
    <div
      data-illustration={scene}
      className={cx(
        "w-full overflow-hidden rounded-[2rem] bg-illustration",
        SIZES[size],
        className,
      )}
    >
      {image}
    </div>
  );
}
