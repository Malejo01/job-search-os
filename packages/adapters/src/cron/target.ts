import { describeDatabaseUrl, isRemoteDatabase, LOCAL_DATABASE_URL } from "@job-search-os/db";

/** Destino y argumentos de `pnpm cron:run`: puros (sin process.env ni I/O). */

export type CronJob = "ingest" | "market";

const USAGE = "uso: pnpm cron:run <ingest|market> [--local | --remote]";

export type CronArgs = { ok: true; job: CronJob; remote: boolean } | { ok: false; error: string };

export function parseCronArgs(argv: readonly string[]): CronArgs {
  let job: CronJob | null = null;
  let local = false;
  let remote = false;
  for (const arg of argv) {
    if (arg === "--local") local = true;
    else if (arg === "--remote") remote = true;
    else if (arg.startsWith("-")) return { ok: false, error: `flag desconocido. ${USAGE}` };
    else if (job !== null) return { ok: false, error: `sobra un argumento. ${USAGE}` };
    else if (arg === "ingest" || arg === "market") job = arg;
    else return { ok: false, error: `job desconocido. ${USAGE}` };
  }
  if (job === null) return { ok: false, error: `falta el job. ${USAGE}` };
  if (local && remote) return { ok: false, error: `--local y --remote son excluyentes. ${USAGE}` };
  return { ok: true, job, remote };
}

export type CronTarget = { ok: true; url: string; label: string } | { ok: false; error: string };

/**
 * Local: DATABASE_URL_LOCAL o la base de Docker; nunca una remota. Remoto: solo dentro de GitHub
 * Actions y con el secret DATABASE_URL; el label no lleva host ni URL (el log de Actions es público).
 */
export function resolveCronTarget(opts: {
  remote: boolean;
  env: Record<string, string | undefined>;
}): CronTarget {
  const { remote, env } = opts;
  if (!remote) {
    const url = env.DATABASE_URL_LOCAL || LOCAL_DATABASE_URL;
    if (isRemoteDatabase(url)) {
      return {
        ok: false,
        error: "el destino local apunta a una base que no es de esta máquina",
      };
    }
    return { ok: true, url, label: `local (${describeDatabaseUrl(url)})` };
  }
  if (env.GITHUB_ACTIONS !== "true") {
    return {
      ok: false,
      error: "--remote solo corre dentro de GitHub Actions: usá Run workflow en Actions › cron",
    };
  }
  const url = env.DATABASE_URL;
  if (!url) return { ok: false, error: "falta el secret DATABASE_URL" };
  return { ok: true, url, label: "remoto" };
}
