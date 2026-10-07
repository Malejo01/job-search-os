import { verifyPassword } from "@job-search-os/db/password";
import { sql } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { getAppDb } from "./lib/db";

/** Hash scrypt válido que ninguna contraseña verifica (sal y hash en cero): solo iguala el costo del login. */
const DUMMY_PASSWORD_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

/**
 * Auth.js con un solo proveedor en fase 1: email + contraseña (ADR-010). El lookup del
 * usuario llega sin sesión: se resuelve con auth_user_by_email (SECURITY DEFINER, rls/0003), porque
 * el rol de la app no puede leer filas ajenas de users. Nunca se loguea la contraseña.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        const [user] = (await getAppDb().execute(
          sql`select id, password_hash from auth_user_by_email(${email})`,
        )) as unknown as { id: string; password_hash: string | null }[];
        // Con email inexistente se verifica igual contra un hash de relleno: el tiempo de respuesta
        // no distingue "no existe" de "contraseña incorrecta" (enumeración de cuentas).
        const passwordOk = verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
        if (!user || !passwordOk) return null;
        return { id: user.id, email };
      },
    }),
  ],
});
