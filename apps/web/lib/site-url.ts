/**
 * URL pública del sitio para metadata, sitemap y robots (ronda 63). `SITE_URL` gana si está (el
 * dominio propio); si no, el dominio de producción que da Vercel, que puede ser el `*.vercel.app`.
 * Sin ninguna de las dos (local, CI), localhost. Se valida: un valor que no es http(s) no se usa.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    env.SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
  ];
  for (const value of candidates) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // valor inválido: se prueba el siguiente
    }
  }
  return "http://localhost:3000";
}
