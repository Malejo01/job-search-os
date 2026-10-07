export type ResetUrlBase = { ok: true; url: string } | { ok: false; error: string };

/**
 * URL base de los links de recuperación (SEC-05). Sale solo de la configuración: nunca de `Host`
 * ni de `x-forwarded-*`, que controla quien hace el pedido. En producción sin configuración
 * devuelve error y el caller no manda el email.
 */
export function resetUrlBase(env: Record<string, string | undefined> = process.env): ResetUrlBase {
  const configured = (env.AUTH_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(
    /\/+$/,
    "",
  );
  if (configured) return { ok: true, url: configured };
  if (env.NODE_ENV !== "production") return { ok: true, url: "http://localhost:3000" };
  return { ok: false, error: "falta AUTH_URL o NEXT_PUBLIC_APP_URL" };
}
