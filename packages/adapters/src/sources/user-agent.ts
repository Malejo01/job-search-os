import { BRAND } from "@job-search-os/pipeline";

/**
 * `User-Agent` identificable para las fuentes públicas (los términos de Get on Board, Remote OK y
 * Jobicy piden consulta moderada e identificable). El dominio sale de la configuración, nunca va
 * escrito acá: se toma el origen de `APP_URL`, si no `NEXT_PUBLIC_APP_URL`, si no `AUTH_URL`.
 *
 * La base es `NombreDelProducto/1.0` (sin espacios): el nombre sale de `BRAND.name` (C6-2) y nunca va
 * escrito acá.
 */
export const SOURCE_USER_AGENT_BASE = `${BRAND.name.replace(/\s+/g, "")}/1.0`;
const BASE = SOURCE_USER_AGENT_BASE;
const ENV_KEYS = ["APP_URL", "NEXT_PUBLIC_APP_URL", "AUTH_URL"] as const;

function originOf(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.host ? url.origin : null;
  } catch {
    return null;
  }
}

export function sourceUserAgent(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  for (const key of ENV_KEYS) {
    const origin = originOf(env[key]);
    if (origin) return `${BASE} (+${origin})`;
  }
  return BASE;
}
