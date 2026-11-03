import { BRAND, BRAND_COLORS } from "@job-search-os/pipeline";
import type { MetadataRoute } from "next";

/**
 * Manifest de la app (C7-2): nombre, colores e íconos para «Agregar a la pantalla de inicio». Los
 * PNG están en `public/icons` (logo B2, C9-4: la «A» índigo con el punto sobre lima; el `maskable` deja margen para el
 * recorte redondo de Android).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: `${BRAND.tagline} Leemos cada oferta contra tu perfil y vos decidís.`,
    lang: "es-AR",
    start_url: "/",
    display: "standalone",
    background_color: BRAND_COLORS.ink,
    theme_color: BRAND_COLORS.ink,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
