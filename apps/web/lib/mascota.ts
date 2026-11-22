/**
 * Base de la mascota (sin la imagen final). Las imágenes viven en `public/mascota/<nombre>.png` (1x) y
 * `public/mascota/<nombre>@2x.png` (2x); las hace quien define la marca. Mientras no existan, el
 * componente `<Mascota>` muestra un marcador neutro del mismo tamaño.
 *
 * Qué imagen existe se declara acá, como en el manifiesto de ilustraciones: un test compara estas
 * banderas con los archivos reales, así que al sumar los PNG el test avisa que hay que pasar la
 * bandera a `true`. Módulo puro: sin I/O, lo leen componentes de servidor y de cliente.
 */
export const MASCOTA_POSES = ["quieta", "hablando", "pensando", "saludo", "festejo"] as const;
export type MascotaPose = (typeof MASCOTA_POSES)[number];

/** Las cinco poses y la cara de 48 px del botón del asistente. */
export type MascotaImagen = MascotaPose | "cara-48";
export const MASCOTA_IMAGENES: readonly MascotaImagen[] = [...MASCOTA_POSES, "cara-48"];

/** `true` solo cuando los PNG (1x y 2x) ya están en `public/mascota/`. */
export const MASCOTA_DISPONIBLE: Record<MascotaImagen, boolean> = {
  quieta: false,
  hablando: false,
  pensando: false,
  saludo: false,
  festejo: false,
  "cara-48": false,
};

/** Rutas 1x y 2x de una imagen, listas para `src` y `srcSet`. */
export function mascotaSrc(imagen: MascotaImagen): { src: string; srcSet: string } {
  const base = `/mascota/${imagen}`;
  return { src: `${base}.png`, srcSet: `${base}.png 1x, ${base}@2x.png 2x` };
}

/** Clave del navegador con el último día que se mostró el saludo. Solo UX, sin datos personales. */
export const SALUDO_STORAGE_KEY = "afinia:mascota-saludo";

/** Día local (AAAA-MM-DD) de `d`, en la zona del navegador. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** El saludo sale una vez por día: si ya se mostró hoy, no. */
export function shouldGreetToday(stored: string | null, today: string): boolean {
  return stored !== today;
}
