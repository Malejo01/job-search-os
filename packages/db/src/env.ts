import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Carga `.env.local` de la raíz del repo si existe (desarrollo local).
 * En CI y producción las variables ya vienen del entorno.
 */
export function loadLocalEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "../../../.env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

/** Postgres de infra/docker-compose.yml, como dueño (migraciones, seeds). */
export const LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:54322/jobsearch";
/** Ídem, como la app: rol jobsearch_app sin ownership ni BYPASSRLS (contraseña la fija db:migrate --local). */
export const LOCAL_APP_DATABASE_URL =
  "postgres://jobsearch_app:jobsearch_app@localhost:54322/jobsearch";
/** Contraseña de desarrollo del rol de la app en Docker. Nunca para la nube. */
export const LOCAL_APP_ROLE_PASSWORD = "jobsearch_app";

export type DbTarget = "local" | "cloud";
/**
 * `app`: requests de usuario (rol jobsearch_app, RLS aplica). `service`: crons y webhooks
 * (dueño con BYPASSRLS por la URL pooled; filtran por user_id explícito, ARCHITECTURE §4).
 * `migration`: dueño por la URL directa (migraciones, seeds, db:sql). `runtime` = `app`.
 */
export type DbPurpose = "app" | "runtime" | "migration" | "service";

/**
 * Destino: `--local` en argv o `DB_TARGET=local` → Docker; si no, la nube (Neon).
 * El desarrollo diario va contra Docker; Neon es paridad y producción (ADR-009).
 */
export function dbTarget(argv: string[] = process.argv): DbTarget {
  if (argv.includes("--local") || process.env.DB_TARGET === "local") return "local";
  return "cloud";
}

/**
 * URL según destino y propósito (ADR-009):
 * - local app: DATABASE_URL_APP_LOCAL o jobsearch_app@Docker.
 * - local migration: DATABASE_URL_LOCAL o postgres@Docker.
 * - cloud app: DATABASE_URL_APP (rol jobsearch_app, pooled); si falta, DATABASE_URL.
 * - cloud service: DATABASE_URL (dueño, pooled).
 * - cloud migration: DATABASE_URL_UNPOOLED (dueño, directa); si falta, DATABASE_URL.
 */
export function resolveDatabaseUrl(
  options: { purpose?: DbPurpose; target?: DbTarget } = {},
): string | undefined {
  const target = options.target ?? dbTarget();
  const purpose =
    options.purpose === "migration" || options.purpose === "service" ? options.purpose : "app";
  if (target === "local") {
    return purpose === "app"
      ? (process.env.DATABASE_URL_APP_LOCAL ?? LOCAL_APP_DATABASE_URL)
      : (process.env.DATABASE_URL_LOCAL ?? LOCAL_DATABASE_URL);
  }
  if (purpose === "migration") return process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (purpose === "service") return process.env.DATABASE_URL;
  return process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;
}

/** Como resolveDatabaseUrl pero falla temprano con mensaje claro. */
export function requireDatabaseUrl(
  options: { purpose?: DbPurpose; target?: DbTarget } = {},
): string {
  const url = resolveDatabaseUrl(options);
  if (!url) throw new Error("DATABASE_URL no está definida (ver .env.example)");
  return url;
}

/** Descripción segura para logs: usuario, host y base, sin credenciales. */
export function describeDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.username ? u.username + "@" : ""}${u.hostname}${u.pathname}`;
  } catch {
    return "<url inválida>";
  }
}
