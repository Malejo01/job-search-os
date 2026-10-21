import { DEMO_PROFILE_KEYS, ROLE_KEYS } from "@job-search-os/pipeline";
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
    ...ROLE_KEYS.map((k) => `/mercado/${k}`),
    "/demo",
    ...DEMO_PROFILE_KEYS.map((k) => `/demo/${k}`),
    "/acceso",
    "/como-esta-hecho",
    "/en/how-its-built",
  ];
  return paths.map((path) => ({ url: `${site}${path === "/" ? "" : path}` }));
}
