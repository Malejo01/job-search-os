/**
 * Tablas con datos del usuario y qué se hace con ellas al borrar la cuenta (JS-092).
 * Es el único lugar donde vive esta lista: `user-tables.test.ts` recorre el schema de Drizzle y
 * falla si aparece una tabla con `user_id`, `created_by_user_id` o `used_by_user_id` que no esté
 * acá, así una tabla nueva sin borrado rompe el CI (mismo enfoque que el test de RLS).
 *
 * No hay FK a `users` (salvo password_reset_tokens, que cae por cascade), así que el borrado es
 * tabla por tabla. Orden: hijos antes que padres. `jobs` arrastra por cascade a `job_sources`,
 * `job_skills`, `evaluations`, `applications` y `application_answers`; se listan igual las que
 * tienen `user_id` para que el conteo sea explícito y no dependa del cascade.
 */
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { verifyPassword } from "./password";

export type UserTableEntry = {
  table: string;
  column: "user_id" | "created_by_user_id" | "used_by_user_id";
  /**
   * `delete`: se borran las filas del usuario. `nullify`: la fila no es del usuario (catálogo
   * compartido o dato de otro dueño), solo se desvincula poniendo la columna en null.
   * `delete_unapproved`: como delete pero solo las filas con approved = false (learning_resources).
   * `release_invitations`: función SECURITY DEFINER de rls/0001 que pone used_by_user_id y email en
   * null en las invitaciones ajenas que canjeó el usuario (la RLS no deja a quien canjeó verlas).
   */
  action: "delete" | "nullify" | "delete_unapproved" | "release_invitations";
};

export const USER_TABLES: readonly UserTableEntry[] = [
  { table: "application_answers", column: "user_id", action: "delete" },
  { table: "answer_bank", column: "user_id", action: "delete" },
  { table: "candidate_facts", column: "user_id", action: "delete" },
  { table: "application_settings", column: "user_id", action: "delete" },
  { table: "inbound_emails", column: "user_id", action: "delete" },
  { table: "raw_blobs", column: "user_id", action: "delete" },
  { table: "inbound_rejections", column: "user_id", action: "delete" },
  { table: "inbound_sender_domains", column: "user_id", action: "delete" },
  { table: "job_queue", column: "user_id", action: "delete" },
  { table: "llm_calls", column: "user_id", action: "delete" },
  // learning_plan_items referencia learning_resources: va antes de tocar los recursos
  { table: "learning_plan_items", column: "user_id", action: "delete" },
  // Catálogo compartido. Decisión de JS-092: los recursos NO aprobados que propuso el usuario se
  // borran; los aprobados quedan en el catálogo sin autor (created_by_user_id = null).
  { table: "learning_resources", column: "created_by_user_id", action: "delete_unapproved" },
  { table: "learning_resources", column: "created_by_user_id", action: "nullify" },
  { table: "market_snapshots", column: "user_id", action: "delete" },
  { table: "skill_interviews", column: "user_id", action: "delete" },
  { table: "skill_evidence", column: "user_id", action: "delete" },
  { table: "skill_levels", column: "user_id", action: "delete" },
  { table: "talent_platforms", column: "user_id", action: "delete" },
  { table: "contacts", column: "user_id", action: "delete" },
  { table: "applications", column: "user_id", action: "delete" },
  { table: "evaluations", column: "user_id", action: "delete" },
  { table: "jobs", column: "user_id", action: "delete" },
  { table: "evaluation_criteria", column: "user_id", action: "delete" },
  { table: "profiles", column: "user_id", action: "delete" },
  // Invitaciones (JS-091): las que creó se borran; si el usuario canjeó una ajena, se
  // desvincula (la invitación es de quien la creó).
  { table: "invitations", column: "created_by_user_id", action: "delete" },
  // El email de la invitación puede ser el del usuario: la función también lo anula (S-2)
  { table: "invitations", column: "used_by_user_id", action: "release_invitations" },
  // Cascade desde users; se lista para que el conteo y la cobertura sean explícitos
  { table: "password_reset_tokens", column: "user_id", action: "delete" },
];

/** `users` se borra siempre al final: el resto de las tablas la referencian lógicamente. */
export const usersTableIsLast = { table: "users", column: "id" } as const;

/**
 * Borra los datos del usuario en `db` (que tiene que ser una transacción abierta con
 * `app.user_id` fijado: las policies RLS acotan cada DELETE a sus filas). Devuelve los conteos
 * por `tabla.columna`, sin datos. Si `users` no se borra exactamente una fila (por ejemplo, falta
 * la policy de DELETE), tira y la transacción entera se deshace: nunca queda una cuenta a medias.
 */
export async function deleteUserData(db: Db, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const e of USER_TABLES) {
    const table = sql.identifier(e.table);
    const column = sql.identifier(e.column);
    let count: number;
    if (e.action === "release_invitations") {
      const rows = await db.execute(sql`select public.release_invitations(${userId}::uuid) as n`);
      count = Number((rows as unknown as { n: number }[])[0]?.n ?? 0);
    } else {
      const result =
        e.action === "nullify"
          ? await db.execute(sql`update ${table} set ${column} = null where ${column} = ${userId}`)
          : e.action === "delete_unapproved"
            ? await db.execute(
                sql`delete from ${table} where ${column} = ${userId} and not approved`,
              )
            : await db.execute(sql`delete from ${table} where ${column} = ${userId}`);
      count = (result as unknown as { count: number }).count;
    }
    counts[`${e.table}.${e.column}${e.action === "delete_unapproved" ? ":unapproved" : ""}`] =
      count;
  }
  const result = await db.execute(
    sql`delete from ${sql.identifier(usersTableIsLast.table)} where ${sql.identifier(usersTableIsLast.column)} = ${userId}`,
  );
  const deletedUsers = (result as unknown as { count: number }).count;
  if (deletedUsers !== 1) {
    throw new Error(`no se pudo borrar la fila de users (borradas: ${deletedUsers})`);
  }
  counts[usersTableIsLast.table] = deletedUsers;
  return counts;
}

/**
 * Confirmación del borrado: el email tiene que ser el de la cuenta y la contraseña la suya.
 * `verifyPassword` corre siempre (aun con email incorrecto) para no distinguir por tiempo.
 */
export function confirmsAccountDeletion(
  user: { email: string; passwordHash: string | null } | undefined,
  input: { email: string; password: string },
): boolean {
  const email = input.email.trim().toLowerCase();
  const emailOk = !!user && email !== "" && user.email.trim().toLowerCase() === email;
  const passwordOk = verifyPassword(input.password, user?.passwordHash);
  return emailOk && passwordOk;
}

/** Columnas que el test de cobertura considera "dueño" de una fila. */
export const OWNER_COLUMNS = ["user_id", "created_by_user_id", "used_by_user_id"] as const;
