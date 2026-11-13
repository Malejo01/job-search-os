import type { NextAuthConfig } from "next-auth";
import { requiresLogin } from "./lib/route-access";

/**
 * Configuración de Auth.js compartida entre el middleware (edge, sin base de datos) y el
 * handler de Node (auth.ts, que suma el proveedor Credentials). ADR-010.
 * Sesión JWT: Credentials no admite sesiones en base de datos en Auth.js; el JWT lleva
 * users.id en `sub` y cada request lo pone en app.user_id (lib/db.ts) para las policies RLS.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  // 14 días (S-6, antes 30): con la versión de sesión, un reset corta las sesiones viejas igual
  session: { strategy: "jwt", maxAge: 14 * 24 * 60 * 60 },
  trustHost: true,
  callbacks: {
    authorized({ auth, request }) {
      const loggedIn = Boolean(auth?.user?.id);
      const { pathname } = request.nextUrl;
      // Con sesión, la entrada a la app es «Hoy» (ronda 119)
      if (pathname.startsWith("/login")) {
        return loggedIn ? Response.redirect(new URL("/hoy", request.nextUrl)) : true;
      }
      // Portada y pedido de acceso (ronda 63): con sesión van a /hoy; sin sesión se ve la vitrina
      if (pathname === "/" || pathname === "/acceso") {
        return loggedIn ? Response.redirect(new URL("/hoy", request.nextUrl)) : true;
      }
      // R9-4: solo las rutas privadas conocidas piden sesión (lib/route-access.ts). Lo público pasa,
      // y lo que no existe también: Next responde su 404 con o sin sesión. Una ruta privada nueva
      // se suma a PRIVATE_PREFIXES; un test recorre `app/` y falla si se olvida.
      // Un request de Server Action (`next-action`) pide sesión salvo en las páginas públicas con acciones propias
      if (!requiresLogin(pathname, request.headers.has("next-action"))) return true;
      return loggedIn;
    },
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        // S-6: la versión de sesión del momento del login; requireUserId la compara con la base
        token.sv = user.sessionVersion ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.sessionVersion = typeof token.sv === "number" ? token.sv : undefined;
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
