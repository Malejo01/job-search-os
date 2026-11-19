/**
 * Cookie de sesión con prefijo `__Host-` cuando la app corre con https: el navegador la acepta solo sin
 * dominio y con `Path=/`, así otro subdominio no puede pisarla. Rige en producción de Vercel (`VERCEL_ENV`,
 * que pone la plataforma y no depende de ninguna variable que se pueda borrar) o con `AUTH_URL` en https.
 * En local (http) rige la de Auth.js.
 * Sin dependencias de Node: la usa también el middleware.
 */
export function sessionCookieConfig(env: Record<string, string | undefined>) {
  const secure = env.VERCEL_ENV === "production" || Boolean(env.AUTH_URL?.startsWith("https://"));
  if (!secure) return undefined;
  return {
    sessionToken: {
      name: "__Host-authjs.session-token",
      options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true },
    },
  };
}
