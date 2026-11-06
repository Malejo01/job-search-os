/**
 * Manifiesto de las ilustraciones del rediseño (C9-12). Las imágenes las genera Mauro aparte y
 * viven en `apps/web/public/ilustraciones/<escena>.webp` (600 × 448) y `<escena>@2x.webp`
 * (1200 × 896), en 4:3. Reglas y cómo sumar una: `ilustraciones.md`, en la carpeta del rediseño.
 *
 * `available: false` → `<Illustration>` muestra el marcador del mismo tamaño (recuadro lavanda con
 * el monograma), así la pantalla no salta cuando llegue la imagen. Un test verifica que el
 * manifiesto y los archivos coincidan: al sumar una imagen, se marca acá como disponible.
 */
export type IllustrationScene =
  "hoy" | "bienvenida" | "cv" | "sin-descripcion" | "vacio" | "postulaciones" | "error" | "acceso";

export type IllustrationInfo = {
  available: boolean;
  /** `ink`: va directo sobre la cabecera índigo. `lavanda`: dentro del recuadro lavanda de 32 px. */
  background: "ink" | "lavanda";
};

export const ILLUSTRATIONS: Record<IllustrationScene, IllustrationInfo> = {
  hoy: { available: true, background: "ink" },
  bienvenida: { available: true, background: "lavanda" },
  cv: { available: true, background: "lavanda" },
  "sin-descripcion": { available: true, background: "lavanda" },
  vacio: { available: true, background: "lavanda" },
  postulaciones: { available: true, background: "lavanda" },
  error: { available: true, background: "lavanda" },
  acceso: { available: true, background: "ink" },
};

/** Proporción y tamaño base (4:3). */
export const ILLUSTRATION_SIZE = { width: 600, height: 448 } as const;

export function illustrationSrc(scene: IllustrationScene): { src: string; srcSet: string } {
  const base = `/ilustraciones/${scene}`;
  return { src: `${base}.webp`, srcSet: `${base}.webp 1x, ${base}@2x.webp 2x` };
}
