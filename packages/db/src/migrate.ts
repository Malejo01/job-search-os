import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import { createDb } from "./client";
import { confirmRemoteTarget } from "./confirm-remote";
import {
  dbTarget,
  describeDatabaseUrl,
  LOCAL_APP_ROLE_PASSWORD,
  loadLocalEnv,
  requireDatabaseUrl,
} from "./env";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type ApplyOptions = {
  /** Fija la contraseña de desarrollo del rol jobsearch_app (solo Docker / tests). */
  localAppPassword?: string;
  log?: (message: string) => void;
};

/**
 * Aplica los archivos de policies en orden alfabético y en una sola transacción: la app nunca ve una
 * tabla con permisos y sin su RLS, y si un archivo falla no queda ninguno aplicado a medias.
 */
export async function applyRlsFiles(
  sql: Sql,
  rlsDir: string,
  log: (message: string) => void,
): Promise<void> {
  const files = readdirSync(rlsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  await sql.begin(async (tx) => {
    // DROP POLICY IF EXISTS emite NOTICE en cada corrida; no es un error
    await tx.unsafe("SET LOCAL client_min_messages = warning");
    for (const file of files) {
      await tx.unsafe(readFileSync(join(rlsDir, file), "utf8"));
      log(`rls ${file}: ok`);
    }
  });
}

/**
 * Aplica las migraciones de Drizzle (packages/db/drizzle) y después las policies RLS
 * (packages/db/rls/*.sql, idempotentes). Reutilizable desde tests.
 */
export async function applyMigrations(url: string, options: ApplyOptions = {}): Promise<void> {
  const log = options.log ?? console.log;
  const { db, sql, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: join(PKG_ROOT, "drizzle") });
    log("migraciones drizzle: ok");

    await applyRlsFiles(sql, join(PKG_ROOT, "rls"), log);

    if (options.localAppPassword) {
      await sql.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${options.localAppPassword}'`);
      log("rol jobsearch_app: contraseña de desarrollo fijada");
    }
  } finally {
    await close();
  }
}

/**
 * Uso: pnpm db:migrate (nube: DATABASE_URL_UNPOOLED, dueño) · pnpm db:migrate:local (Docker).
 * Contra la nube pide escribir "si" (o CONFIRM_PRODUCTION=si sin terminal): ver confirm-remote.ts.
 * En Neon la contraseña de jobsearch_app la carga Mauro (DATABASE_URL_APP); acá no se toca.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireDatabaseUrl({ purpose: "migration" });
  console.log(`→ ${describeDatabaseUrl(url)}`);
  // Salvaguarda: contra una base remota (producción) hay que confirmar con "si" (2026-09-22)
  if (!(await confirmRemoteTarget(url, { action: "migrar" }))) {
    console.error("db:migrate cancelado: no se tocó la base.");
    process.exit(1);
  }
  await applyMigrations(url, {
    localAppPassword: dbTarget() === "local" ? LOCAL_APP_ROLE_PASSWORD : undefined,
  });
}

if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error("db:migrate falló:", error);
    process.exit(1);
  });
}
