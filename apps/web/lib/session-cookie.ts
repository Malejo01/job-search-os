/**
 * Cookie de sesión con prefijo `__Host-` cuando la app corre con https: el navegador la acepta solo sin
 * dominio y con `Path=/`, así otro subdominio no puede pisarla. En local (http) rige la de Auth.js.
 * Sin dependencias de Node: la usa también el middleware.
 */
export function sessionCookieConfig(env: Record<string, string | undefined>) {
  if (!env.AUTH_URL?.startsWith("https://")) return undefined;
  return {
    sessionToken: {
      name: "__Host-authjs.session-token",
      options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true },
    },
  };
}
