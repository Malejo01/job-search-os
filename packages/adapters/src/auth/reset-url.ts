import { siteOrigin } from "@job-search-os/pipeline";

export type ResetUrlBase = { ok: true; url: string } | { ok: false; error: string };

/**
 * URL base de los links de los emails (recuperar contraseña, invitaciones; SEC-05). Sale solo de la
 * configuración: nunca de `Host` ni de `x-forwarded-*`, que controla quien hace el pedido. `SITE_URL`
 * gana (C3-4: una sola variable para el dominio público); si no está, valen `AUTH_URL` y
 * `NEXT_PUBLIC_APP_URL` como hasta ahora. En producción sin ninguna devuelve error y el caller no manda
 * el email.
 */
export function resetUrlBase(env: Record<string, string | undefined> = process.env): ResetUrlBase {
  const site = siteOrigin(env);
  if (site) return { ok: true, url: site };
  const configured = (env.AUTH_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(
    /\/+$/,
    "",
  );
  if (configured) return { ok: true, url: configured };
  if (env.NODE_ENV !== "production") return { ok: true, url: "http://localhost:3000" };
  return { ok: false, error: "falta SITE_URL (o AUTH_URL / NEXT_PUBLIC_APP_URL)" };
}
