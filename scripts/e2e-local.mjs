// e2e locales reproducibles (R8-3). Dos modos, sin variables de entorno delante del comando:
//
//   pnpm e2e:local:prepare        migra y siembra la base local de Docker con datos de EJEMPLO
//                                 (SEED_FIXTURES=example: nunca fixtures-private/) y el usuario de e2e
//   pnpm e2e:local [20 126 ...]   corre Playwright contra la app local; los números filtran specs
//
// Es imposible apuntar a Neon: las variables de base que existan en el entorno tienen que ser de
// localhost (si no, el script corta antes de lanzar nada) y los hijos reciben DB_TARGET=local con
// las URLs locales fijadas explícitas. No lee `.env*`. LLM en modo demo, sin gasto.
//
// La parte pura (guarda, entorno, filtros) está exportada para los tests; `main` solo corre si el
// archivo se ejecuta directo.

/* global process, console, URL, setTimeout, clearTimeout */
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Mismos valores que `packages/db/src/env.ts` y que el job `e2e` del CI (todos ficticios). */
export const LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:54322/jobsearch";
export const LOCAL_APP_DATABASE_URL =
  "postgres://jobsearch_app:jobsearch_app@localhost:54322/jobsearch";
export const E2E_EMAIL = "mauro@job-search-os.local";
export const E2E_PASSWORD = "dev-password-local";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Falla cerrado si la URL no es de Postgres o si algún host no es de loopback. */
export function assertLocalDatabaseUrl(url) {
  const raw = String(url ?? "").trim();
  if (!URL.canParse(raw)) throw new Error("La URL de la base no es válida");
  const parsed = new URL(raw);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("La URL de la base no es de Postgres");
  }
  // Tramo que postgres.js trata como autoridad (entre `://` y el primer `/` o `?`): ambigüedades fuera
  const authority = raw.slice(raw.indexOf("://") + 3).split(/[?/]/)[0] ?? "";
  if (/[,#]/.test(authority) || authority.split("@").length > 2) {
    throw new Error(
      "La URL de la base es ambigua (',', '#' o más de un '@'): encodeá la contraseña",
    );
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(host)) {
    // Sin imprimir la URL: puede traer credenciales
    throw new Error("La base no es local: los e2e solo corren contra localhost, 127.0.0.1 o ::1");
  }
}

/**
 * Revisa todo el entorno: cualquier variable con forma de base (DATABASE*, PGHOST, *_URL con postgres
 * o un valor `postgres://`) tiene que ser local. Un DATABASE_URL de Neon en el entorno corta, no se ignora.
 */
export function assertLocalEnv(env) {
  for (const [name, value] of Object.entries(env)) {
    if (!value?.trim()) continue;
    const isHost = /^PG(HOST|HOSTADDR)$/i.test(name);
    const byName = /^DATABASE/i.test(name) || (/_URL$/i.test(name) && /postgres/i.test(value));
    if (!isHost && !byName && !/^\s*postgres(ql)?:\/\//i.test(value)) continue;
    try {
      if (isHost) {
        if (
          !LOCAL_HOSTS.has(
            value
              .trim()
              .toLowerCase()
              .replace(/^\[|\]$/g, ""),
          )
        ) {
          throw new Error("La base no es local");
        }
      } else {
        assertLocalDatabaseUrl(value);
      }
    } catch (e) {
      throw new Error(`${e.message} (variable ${name})`, { cause: e });
    }
  }
}

/**
 * Entorno de los procesos hijos. Valida primero el entorno heredado y después fija lo local: las
 * URLs van explícitas porque `loadEnvFile` no pisa variables ya definidas, así que un `.env.local`
 * no puede redirigir la base.
 */
export function buildLocalEnv(base) {
  assertLocalEnv(base);
  const env = { ...base };
  delete env.CONFIRM_PRODUCTION;
  delete env.CI; // sin CI el config de Playwright usa `next dev`, sin retries
  env.DB_TARGET = "local";
  env.LLM_DEMO = "1";
  env.LLM_DAILY_CAP_USD = "0";
  env.DATABASE_URL_LOCAL ||= LOCAL_DATABASE_URL;
  env.DATABASE_URL_APP_LOCAL ||= LOCAL_APP_DATABASE_URL;
  assertLocalDatabaseUrl(env.DATABASE_URL_LOCAL);
  assertLocalDatabaseUrl(env.DATABASE_URL_APP_LOCAL);
  // Solo datos de ejemplo: nunca fixtures-private/
  env.SEED_FIXTURES = "example";
  env.SEED_USER_EMAIL = E2E_EMAIL;
  env.SEED_USER_PASSWORD = E2E_PASSWORD;
  env.E2E_EMAIL = E2E_EMAIL;
  env.E2E_PASSWORD = E2E_PASSWORD;
  env.ADMIN_EMAILS = E2E_EMAIL;
  env.AUTH_SECRET ||= "local-e2e-only-not-a-secret";
  env.MCP_TOKEN ||= "local-e2e-only-not-a-secret";
  return env;
}

/**
 * Argumentos de Playwright para los filtros de specs: `20` pasa a `[^0-9]20-` (el prefijo numérico del
 * archivo, sin confundir 20 con 120); un nombre (`login`) pasa tal cual. Solo letras, números y guiones.
 */
export function specFilters(args) {
  return args.map((a) => {
    if (!/^[\w-]{1,60}$/.test(a)) throw new Error(`Filtro de spec no válido: ${JSON.stringify(a)}`);
    return /^\d+$/.test(a) ? `[^0-9]${a}-` : a;
  });
}

const IS_WIN = process.platform === "win32";
const MIN = 60_000;

function killTree(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // el proceso ya terminó
  }
}

/** Corre `pnpm <args>` con timeout duro que mata el árbol (en Windows pnpm es un .cmd: va con shell). */
function runPnpm(args, env, timeoutMs) {
  return new Promise((done) => {
    const child = IS_WIN
      ? spawn(["pnpm", ...args.map((a) => `"${a}"`)].join(" "), [], {
          cwd: ROOT,
          env,
          shell: true,
          stdio: "inherit",
        })
      : spawn("pnpm", args, { cwd: ROOT, env, detached: true, stdio: "inherit" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      done(1);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(timedOut ? 124 : (code ?? 1));
    });
  });
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== "prepare" && mode !== "run") {
    console.error("Uso: e2e-local.mjs prepare | run [filtros de spec]");
    return 1;
  }
  let env;
  let filters = [];
  try {
    env = buildLocalEnv(process.env);
    if (mode === "run") filters = specFilters(rest);
    else if (rest.length) throw new Error("prepare no acepta argumentos");
  } catch (e) {
    console.error(`e2e-local: ${e.message}`);
    return 1;
  }
  console.error(
    `[e2e-local] ${mode}: base local (DB_TARGET=local), datos de ejemplo, LLM en modo demo. Docker (jso-postgres) tiene que estar abierto.`,
  );
  if (mode === "prepare") {
    const migrate = await runPnpm(["db:migrate:local"], env, 5 * MIN);
    if (migrate !== 0) return migrate;
    return runPnpm(["db:seed:local"], env, 5 * MIN);
  }
  return runPnpm(["--filter", "@job-search-os/web", "e2e", ...filters], env, 30 * MIN);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await main());
}
