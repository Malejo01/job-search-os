/**
 * URL pública del sitio (C3-4). Puro: recibe el entorno ya leído y devuelve decisiones.
 *
 * Una sola variable, `SITE_URL` (ej. `https://afiniajobs.com.ar`), manda sobre todo lo que sale hacia
 * afuera: el canonical, el sitemap, el robots, Open Graph, los links de los emails (recuperar contraseña,
 * invitaciones) y la lista de orígenes permitidos. Si falta, cada lugar sigue usando el respaldo que ya
 * tenía (`AUTH_URL`, `NEXT_PUBLIC_APP_URL`, el dominio de producción de Vercel), así que no cambia nada
 * hasta que se carga la variable. El dominio viejo se redirige con `LEGACY_HOSTS` (ver `legacyHostRedirects`).
 */

type Env = Record<string, string | undefined>;

/**
 * Origen (`https://dominio`) de una URL, o null. Solo http(s), sin credenciales; descarta ruta, parámetros
 * y barra final. Un valor que no se puede leer no se usa: se prueba el siguiente respaldo.
 */
export function parseOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.host || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** El sitio, según `SITE_URL`; null si no está o no es una URL http(s) válida. */
export function siteOrigin(env: Env): string | null {
  return parseOrigin(env.SITE_URL);
}

/** Tope de dominios viejos: un valor armado de más no genera cientos de reglas en cada build. */
export const MAX_LEGACY_HOSTS = 10;

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * `LEGACY_HOSTS`: dominios que ya no son el principal, separados por comas (`busquedalaboral.malejo.com.ar`).
 * Solo nombres de host: sin esquema, ruta, puerto ni comodines. En minúscula y sin repetir.
 */
export function parseLegacyHosts(value: string | undefined): string[] {
  const hosts: string[] = [];
  for (const raw of (value ?? "").split(",")) {
    const host = raw.trim().toLowerCase();
    if (!host || !HOSTNAME.test(host) || hosts.includes(host)) continue;
    hosts.push(host);
    if (hosts.length >= MAX_LEGACY_HOSTS) break;
  }
  return hosts;
}

export type LegacyRedirect = {
  source: string;
  has: { type: "host"; value: string }[];
  destination: string;
  permanent: true;
};

/**
 * Redirecciones permanentes (308) de cada dominio viejo al sitio nuevo, con la ruta y los parámetros.
 * Formato de `redirects()` de Next, que las evalúa al construir: cambiar `SITE_URL` o `LEGACY_HOSTS`
 * pide un deploy nuevo.
 *
 * Nunca tocan `/api/*` ni `/_next/*`: el webhook de Resend, los crons de GitHub, el MCP y el smoke siguen
 * apuntando al host viejo hasta que se actualicen a mano, y una redirección a un POST puede perderlos.
 * Sin `SITE_URL` válida o sin hosts no hay reglas. El host nuevo no se redirige a sí mismo.
 */
export function legacyHostRedirects(env: Env): LegacyRedirect[] {
  const site = siteOrigin(env);
  if (!site) return [];
  const siteHost = new URL(site).host.toLowerCase();
  const rules: LegacyRedirect[] = [];
  for (const host of parseLegacyHosts(env.LEGACY_HOSTS)) {
    if (host === siteHost) continue;
    // El host de `has` es una regex: los puntos se escapan para que no coincida con otro dominio
    const has = [{ type: "host" as const, value: host.replace(/\./g, "\\.") }];
    rules.push(
      { source: "/", has, destination: `${site}/`, permanent: true },
      {
        source: "/:path((?!api/|_next/).+)",
        has,
        destination: `${site}/:path`,
        permanent: true,
      },
    );
  }
  return rules;
}
