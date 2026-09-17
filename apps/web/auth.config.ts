import type { NextAuthConfig } from "next-auth";

/**
 * Configuración de Auth.js compartida entre el middleware (edge, sin base de datos) y el
 * handler de Node (auth.ts, que suma el proveedor Credentials). ADR-010.
 * Sesión JWT: Credentials no admite sesiones en base de datos en Auth.js; el JWT lleva
 * users.id en `sub` y cada request lo pone en app.user_id (lib/db.ts) para las policies RLS.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  callbacks: {
    authorized({ auth, request }) {
      const loggedIn = Boolean(auth?.user?.id);
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/login")) {
        return loggedIn ? Response.redirect(new URL("/jobs", request.nextUrl)) : true;
      }
      // Recuperación de contraseña y setup inicial (JS-045): se usan sin sesión activa.
      if (
        pathname.startsWith("/forgot-password") ||
        pathname.startsWith("/reset-password") ||
        pathname.startsWith("/setup")
      ) {
        return true;
      }
      return loggedIn;
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
