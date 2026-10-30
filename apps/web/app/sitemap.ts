import {
  DEMO_PROFILE_KEYS,
  pricingEnabled,
  ROLE_KEYS,
  UNLISTED_ROLE_KEYS,
} from "@job-search-os/pipeline";
import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * Sitemap de la vitrina pública (ronda 63): portada, mercado, una página por carrera y el pedido
 * de acceso. /ofertas queda afuera a propósito (noindex). Sin base ni sesión: se genera en el build.
 */
const site = siteUrl();

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/mercado",
    // Las carreras sin publicar (C-2b, D2) responden pero no se anuncian
    ...ROLE_KEYS.filter((k) => !(UNLISTED_ROLE_KEYS as readonly string[]).includes(k)).map(
      (k) => `/mercado/${k}`,
    ),
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
