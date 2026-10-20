import { createDb, loadLocalEnv } from "@job-search-os/db";
import pino from "pino";
import { safeError } from "../admin/common";
import { createLogger } from "../logger";
import { runIngestCron } from "./ingest";
import { runMarketCron } from "./market";
import { parseCronArgs, resolveCronTarget } from "./target";

/**
 * pnpm cron:run <ingest|market> [--local | --remote]
 * Local por defecto (Docker). `--remote` solo corre dentro de GitHub Actions, con el secret
 * DATABASE_URL; ahí el log es público: logger en silencio y una sola línea con agregados.
 */
async function main(): Promise<void> {
  const args = parseCronArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  // En remoto todo viene del entorno del runner: no se carga .env.local
  if (!args.remote) loadLocalEnv();
  const target = resolveCronTarget({ remote: args.remote, env: process.env });
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }
  // Los logs de pino llevan user_id y el log de Actions es público
  const logger = args.remote ? pino({ level: "silent" }) : createLogger({ cron: args.job });
  const { db, close } = createDb(target.url, { max: 2 });
  try {
    console.log(`→ ${target.label}`);
    const result =
      args.job === "ingest"
        ? await runIngestCron({ db, logger })
        : await runMarketCron({ db, logger });
    console.log(JSON.stringify(result.body));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`cron:run falló: ${safeError(error)}`);
  process.exit(1);
});
