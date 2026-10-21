import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * robots.txt (ronda 63): se indexan `/`, `/mercado` y `/acceso`. `/ofertas` NO se bloquea: lleva
 * `noindex` y el robot tiene que poder leerlo. Lo privado de la app queda bloqueado.
 */
const site = siteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/mercado", "/acceso"],
      disallow: [
        "/api/",
        "/hoy",
        "/jobs",
        "/inbox",
        "/applications",
        "/market",
        "/plan",
        "/settings",
        "/onboarding",
      ],
    },
    sitemap: `${site}/sitemap.xml`,
  };
}
