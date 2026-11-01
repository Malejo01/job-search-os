import { siteOrigin } from "@job-search-os/pipeline";

/**
 * URL pública del sitio para metadata, sitemap, robots y Open Graph (ronda 63, C3-4). `SITE_URL` gana si
 * está (el dominio propio, la única variable que hay que cambiar al mudar de dominio); si no, el dominio
 * de producción que da Vercel, que puede ser el `*.vercel.app`. Sin ninguna de las dos (local, CI),
 * localhost. Se valida: un valor que no es http(s) no se usa.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const site = siteOrigin(env);
  if (site) return site;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) {
    try {
      const url = new URL(`https://${vercel}`);
      if (url.host) return url.origin;
    } catch {
      // valor inválido: se usa el respaldo local
    }
  }
  return "http://localhost:3000";
}
