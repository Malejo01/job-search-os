import type { ImageLoaderProps } from "next/image";

/**
 * Loader de `next/image` para las ilustraciones (`apps/web/public/ilustraciones/`).
 *
 * Cada escena tiene dos archivos ya optimizados: `<escena>.webp` (600 × 448) y `<escena>@2x.webp`
 * (1200 × 896). Este loader los usa tal cual en el `srcSet` en vez de pasar por el optimizador de
 * imágenes: no hay una tercera recodificación con pérdida y no gasta cuota de transformaciones.
 *
 * Con un `width` fijo, `next/image` pide dos anchos (el pedido, redondeado a un tamaño de la
 * lista, y el doble). Hasta 640 va la normal; más ancho, la `@2x`. Se registra en `next.config.ts`
 * (`images.loaderFile`) y vale para todo `next/image` de la app: hoy no hay otro uso.
 */
export default function illustrationLoader({ src, width }: ImageLoaderProps): string {
  if (width <= 640 || !src.endsWith(".webp") || src.endsWith("@2x.webp")) return src;
  return src.replace(/\.webp$/, "@2x.webp");
}
