import { schema as s } from "@job-search-os/db";
import { hashPassword } from "@job-search-os/db/password";
import { getAppDb } from "./db";

/** Bootstrap (JS-045/ADR-012): true si ya existe algún usuario. Sin esto, /setup queda cerrado. */
export async function hasAnyUser(): Promise<boolean> {
  const [row] = await getAppDb().select({ id: s.users.id }).from(s.users).limit(1);
  return Boolean(row);
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
