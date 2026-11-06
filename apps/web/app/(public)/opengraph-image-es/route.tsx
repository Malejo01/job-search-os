import { brandOgImage } from "@/lib/og-image";

/**
 * Imagen para compartir de la vitrina en español con ruta FIJA (`/opengraph-image-es`), la misma que
 * `(public)/opengraph-image.tsx`. Hace falta porque las páginas definen su propio `openGraph` (para
 * publicar `og:url`) y la imagen por convención de archivo lleva un sufijo de Next que no se puede
 * escribir a mano; en las páginas anidadas Next tampoco la agrega sola. `auth.config.ts` ya deja
 * pública cualquier ruta que empiece con `/opengraph-image`. Mismo patrón que `opengraph-image-en`.
 */
export const dynamic = "force-static";

export function GET() {
  return brandOgImage({ line: "Leemos cada oferta contra tu perfil. Vos decidís." });
}
