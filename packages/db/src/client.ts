import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

/**
 * Base o transacción: PgDatabase es la clase común, así los adapters (cola, ingesta) aceptan
 * también la `tx` de la app (withUser) sin casts.
 */
export type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

/**
 * Crea un cliente Drizzle sobre postgres.js. `max: 1` para scripts (migraciones, seeds);
 * la app pasa un pool mayor. Cerrar con `close()` al terminar en scripts.
 */
export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 1, prepare: false });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}
