import { schema as s } from "@job-search-os/db";
import { hashPassword } from "@job-search-os/db/password";
import { sql } from "drizzle-orm";
import { getAppDb } from "./db";

/** Bootstrap (JS-045/ADR-012): true si ya existe algún usuario. Sin esto, /setup queda cerrado. */
export async function hasAnyUser(): Promise<boolean> {
  // has_any_user (SECURITY DEFINER): ve todas las filas aunque users_read quede en la propia.
  const [row] = (await getAppDb().execute(sql`select has_any_user() as any_user`)) as unknown as {
    any_user: boolean;
  }[];
  return Boolean(row?.any_user);
}

/**
 * Crea EL usuario de la app. Solo funciona con la tabla vacía: la policy RLS
 * `users_bootstrap_insert` lo exige también del lado de la base (defensa en profundidad,
 * no solo este chequeo). No es registro público: una vez creado, no hay forma de crear otro.
 */
export async function createFirstUser(email: string, password: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("el email es obligatorio");
  if (await hasAnyUser()) throw new Error("ya existe un usuario");
  const passwordHash = hashPassword(password);
  await getAppDb().insert(s.users).values({ email: normalized, passwordHash });
}
