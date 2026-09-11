import { createDb, describeDatabaseUrl, requireDatabaseUrl, type Db } from "@job-search-os/db";
import { sql } from "drizzle-orm";

/**
 * Conexión de la app: SIEMPRE el rol de la app (DATABASE_URL_APP / DATABASE_URL_APP_LOCAL,
 * purpose "app"), nunca el dueño. Las policies RLS hacen el aislamiento; por eso al arrancar
 * se verifica que el rol no tenga BYPASSRLS ni sea dueño de tablas: si lo es, falla ruidosamente
 * (ADR-010, JS-014). Corre en el layout de la app y en withUser. Crons y webhooks usan purpose "service" en su propio route handler.
 */
type Conn = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __appDb?: Conn; __appRoleCheck?: Promise<void> };

export function getAppDb(): Db {
  if (!g.__appDb) {
    const url = requireDatabaseUrl({ purpose: "app" });
    g.__appDb = createDb(url, { max: 5 });
  }
  return g.__appDb.db;
}

export class AppRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppRoleError";
  }
}

/** Verifica una sola vez por proceso que el rol conectado no puede saltear RLS. */
export function assertAppRole(): Promise<void> {
  if (!g.__appRoleCheck) {
    g.__appRoleCheck = (async () => {
      const db = getAppDb();
      const url = requireDatabaseUrl({ purpose: "app" });
      const [role] = (await db.execute(
        sql`select current_user as name, rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = current_user`,
      )) as unknown as { name: string; super: boolean; bypass: boolean }[];
      const [owned] = (await db.execute(
        sql`select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = current_user`,
      )) as unknown as { n: number }[];
      const problems: string[] = [];
      if (role?.bypass) problems.push("tiene BYPASSRLS");
      if (role?.super) problems.push("es superusuario");
      if ((owned?.n ?? 0) > 0) problems.push(`es dueño de ${owned!.n} tablas en public`);
      if (problems.length) {
        throw new AppRoleError(
          `la app está conectada como '${role?.name}' (${describeDatabaseUrl(url)}), que ${problems.join(" y ")}: RLS no aplicaría. DATABASE_URL_APP tiene que ser el rol jobsearch_app (packages/db/drizzle/0003_app_role.sql).`,
        );
      }
    })().catch((e) => {
      g.__appRoleCheck = undefined; // que el próximo request vuelva a intentar (y vuelva a fallar a la vista)
      throw e;
    });
  }
  return g.__appRoleCheck;
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Corre `fn` en una transacción con `app.user_id` fijado para ese usuario: las policies
 * `user_id = auth.uid()` ven solo sus filas. Es la única forma en que la app toca datos de usuario.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await assertAppRole();
  return getAppDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
