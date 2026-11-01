import { DEMO_PROFILE_KEYS, pricingEnabled } from "@job-search-os/pipeline";
import type { MetadataRoute } from "next";
import { getPublicCareerKeys } from "@/lib/career-visibility";
import { siteUrl } from "@/lib/site-url";

/**
 * Sitemap de la vitrina pública (ronda 63): portada, mercado, una página por carrera y el pedido
 * de acceso. /ofertas queda afuera a propósito (noindex). Sin sesión. Las carreras salen de
 * `getPublicCareerKeys()` (ADR-029), así que se regenera cada hora y no solo en el build.
 */
const site = siteUrl();

// El sitemap se regenera cada hora: una carrera de la beta aparece sola al llegar a 10 ofertas
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const careers = await getPublicCareerKeys();
  const paths = [
    "/",
    "/mercado",
    // Las carreras ocultas (ADR-029) responden pero no se anuncian
    ...careers.map((k) => `/mercado/${k}`),
    "/demo",
    ...DEMO_PROFILE_KEYS.map((k) => `/demo/${k}`),
    "/acceso",
    "/como-esta-hecho",
    "/en/how-its-built",
    // C-12: solo con los precios encendidos; si no, la página da 404
    ...(pricingEnabled(process.env) ? ["/precios"] : []),
  ];
  return paths.map((path) => ({ url: `${site}${path === "/" ? "" : path}` }));
}
