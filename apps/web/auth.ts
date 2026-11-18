import { verifyPasswordAsync } from "@job-search-os/db/password";
import { sql } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { getAppDb } from "./lib/db";
import {
  authorizeCredentials,
  createVerificationPacer,
  type LoginDeps,
} from "./lib/login-credentials";

/**
 * Lo que el login necesita de la base. Llega sin sesión: todo pasa por funciones SECURITY DEFINER (rls/0003
 * y rls/0023), porque el rol de la app no puede leer filas ajenas de users.
 */
const loginDeps: LoginDeps = {
  async beginAttempt(emailHash) {
    const [row] = (await getAppDb().execute(
      sql`select login_attempt_begin(${emailHash}) as allowed`,
    )) as unknown as { allowed: boolean }[];
    return row?.allowed === true;
  },
  async clearAttempts(emailHash) {
    await getAppDb().execute(sql`select login_attempt_clear(${emailHash})`);
  },
  async findUser(email) {
    const [user] = (await getAppDb().execute(
      sql`select id, password_hash from auth_user_by_email(${email})`,
    )) as unknown as { id: string; password_hash: string | null }[];
    return user;
  },
  ...createVerificationPacer(verifyPasswordAsync),
  // S-6: la versión de sesión vigente va al JWT (auth.config.ts, callback jwt)
  async sessionVersion(userId) {
    const [row] = (await getAppDb().execute(
      sql`select user_session_version(${userId}::uuid) as v`,
    )) as unknown as { v: number | null }[];
    return row?.v ?? 0;
  },
};

/** Auth.js con un solo proveedor en fase 1: email + contraseña (ADR-010). Nunca se loguea la contraseña. */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Contraseña", type: "password" },
      },
      authorize: (credentials) => authorizeCredentials(loginDeps, credentials),
    }),
  ],
});
