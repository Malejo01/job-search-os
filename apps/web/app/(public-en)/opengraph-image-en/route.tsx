import { brandOgImage } from "@/lib/og-image";

/**
 * Imagen para compartir de la vitrina en inglés (ronda 122, marca en C7-2; Afi en R27-06): misma
 * composición que `(public)/opengraph-image.tsx`, con la bajada y la línea en inglés. Es un route handler y no un
 * `opengraph-image.tsx` dentro de `/en` porque `auth.config.ts` deja pública cualquier ruta que
 * empiece con `/opengraph-image`, y `/en/opengraph-image` no entraría.
 */
export const dynamic = "force-static";

export function GET() {
  return brandOgImage({
    tagline: "Your smart employability assistant",
    taglineSecondary: "Matching jobs. Sharper CV.",
    line: "We read each posting against your profile. You decide.",
  });
}
