import { BRAND } from "@job-search-os/pipeline";
import { brandOgImage, OG_SIZE } from "@/lib/og-image";

/** Imagen para compartir (ronda 63, marca en C7-2): logo, bajada y la propuesta de valor. */
export const alt = `${BRAND.name}: ${BRAND.tagline} Leemos cada oferta contra tu perfil y vos decidís.`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return brandOgImage({ line: "Leemos cada oferta contra tu perfil. Vos decidís." });
}
