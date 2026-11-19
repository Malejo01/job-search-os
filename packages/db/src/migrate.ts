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

/** Espera máxima por un lock dentro de la transacción de RLS, y esperas entre reintentos (uno por reintento). */
export const RLS_LOCK_TIMEOUT_MS = 5_000;
export const RLS_RETRY_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000];

export type RlsLockOptions = {
  lockTimeoutMs?: number;
  /** Una espera por reintento: su largo es la cantidad de reintentos. */
  backoffMs?: readonly number[];
};

/** lock_not_available: el lock no se consiguió dentro de `lock_timeout`. */
const isLockTimeout = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "55P03";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Aplica los archivos de policies en orden alfabético y en una sola transacción: la app nunca ve una
 * tabla con permisos y sin su RLS, y si un archivo falla no queda ninguno aplicado a medias.
 *
 * Cada DROP POLICY o ALTER TABLE pide un lock exclusivo y lo retiene hasta el final de la transacción. Si una
 * transacción larga de la app tiene la tabla, esperar sin límite deja en cola a todas las consultas que vienen
 * detrás. Por eso la transacción tiene `lock_timeout`: si vence se revierte entera y se reintenta con espera
 * creciente; si se agotan los reintentos falla con un mensaje claro. Cualquier otro error no se reintenta.
 */
export async function applyRlsFiles(
  sql: Sql,
  rlsDir: string,
  log: (message: string) => void,
  options: RlsLockOptions = {},
): Promise<void> {
  const lockTimeoutMs = options.lockTimeoutMs ?? RLS_LOCK_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? RLS_RETRY_BACKOFF_MS;
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs <= 0) {
    throw new Error("lockTimeoutMs tiene que ser un entero positivo de milisegundos.");
  }
  const files = readdirSync(rlsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let attempt = 0; ; attempt++) {
    try {
      await sql.begin(async (tx) => {
        // DROP POLICY IF EXISTS emite NOTICE en cada corrida; no es un error
        await tx.unsafe("SET LOCAL client_min_messages = warning");
        await tx.unsafe(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
        for (const file of files) {
          await tx.unsafe(readFileSync(join(rlsDir, file), "utf8"));
          log(`rls ${file}: ok`);
        }
      });
      return;
    } catch (error) {
      if (!isLockTimeout(error)) throw error;
      const wait = backoffMs[attempt];
      if (wait === undefined) {
        throw new Error(
          `RLS no aplicado: una tabla sigue bloqueada por otra conexión tras ${attempt + 1} intentos ` +
            `(lock_timeout ${lockTimeoutMs} ms). No quedó nada aplicado: revertí la transacción entera. ` +
            "Esperá a que termine la transacción que retiene la tabla y volvé a correr la migración.",
          { cause: error },
        );
      }
      log(
        `rls: tabla bloqueada (intento ${attempt + 1}, lock_timeout ${lockTimeoutMs} ms); ` +
          `transacción revertida, reintento en ${wait} ms`,
      );
      await sleep(wait);
    }
  }
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
