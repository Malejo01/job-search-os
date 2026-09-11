import { schema as s } from "@job-search-os/db";
import { verifyPassword } from "@job-search-os/db/password";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { getAppDb } from "./lib/db";

/**
 * Auth.js con un solo proveedor en fase 1: email + contraseña (ADR-010). El lookup del
 * usuario corre con el rol de la app: la policy `users_read` permite leer users sin sesión
 * (no hay registro público, un solo usuario). Nunca se loguea la contraseña.
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
        const [user] = await getAppDb()
          .select({
            id: s.users.id,
            email: s.users.email,
            name: s.users.name,
            hash: s.users.passwordHash,
          })
          .from(s.users)
          .where(eq(s.users.email, email))
          .limit(1);
        if (!user || !verifyPassword(password, user.hash)) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
});
