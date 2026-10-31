import { loadLocalEnv } from "@job-search-os/db";
import { legacyHostRedirects } from "@job-search-os/pipeline";
import type { NextConfig } from "next";

// Variables del repo (.env.local en la raíz) también para next dev / next build local.
// En Vercel no existe el archivo y no hace nada.
loadLocalEnv();
// next dev apunta a Docker salvo que se pida la nube explícitamente (DB_TARGET=cloud).
if (process.env.NODE_ENV !== "production" && !process.env.DB_TARGET) {
  process.env.DB_TARGET = "local";
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Los packages del monorepo se consumen como TypeScript fuente
  // Los prompts se leen del disco en runtime: sin esto no viajan en el bundle serverless de Vercel
  outputFileTracingIncludes: {
    "/**": ["../../packages/prompts/*.md"],
    // Textos legales que /legal/* y /register (los muestra en la página) leen del disco
    "/register": ["./content/legal/*.md"],
    "/legal/privacidad": ["./content/legal/*.md"],
    "/legal/terminos": ["./content/legal/*.md"],
  },
  // Las URLs viejas siguen andando, también sin sesión (JS-106); las páginas de (app) quedan de cinturón
  async redirects() {
    return [
      { source: "/privacidad", destination: "/legal/privacidad", permanent: false },
      { source: "/terminos", destination: "/legal/terminos", permanent: false },
      // `producto_proyectos` se partió en cuatro carreras (ronda 97, ADR-019): las URLs públicas
      // indexadas pasan a la primera. 308 (permanent) y acá, no en la página, para responder sin base.
      {
        source: "/mercado/producto_proyectos",
        destination: "/mercado/product_manager",
        permanent: true,
      },
      {
        source: "/ofertas/producto_proyectos",
        destination: "/ofertas/product_manager",
        permanent: true,
      },
      // Cambio de dominio (C3-4): el dominio viejo (LEGACY_HOSTS) redirige al nuevo (SITE_URL) con la ruta
      // y los parámetros, menos /api y /_next. Sin esas variables no agrega nada. Se evalúa al construir
      ...legacyHostRedirects(process.env),
    ];
  },
  // Headers de seguridad globales. La CSP lleva solo frame-ancestors (la completa es otro ticket);
  // limitan que nos enmarquen, no los iframes propios con srcDoc.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Sin interest-cohort: Chrome ya no lo reconoce y lo informa como error en la consola
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      // Va después de la global a propósito: con la misma clave gana la última entrada que matchea.
      // El token del reset viaja en la query: que no salga en el Referer hacia otros sitios (SEC-05).
      {
        source: "/reset-password",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
  transpilePackages: [
    "@job-search-os/adapters",
    "@job-search-os/db",
    "@job-search-os/pipeline",
    "@job-search-os/prompts",
  ],
};

export default nextConfig;
