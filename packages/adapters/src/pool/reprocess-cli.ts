import { createDb, loadLocalEnv } from "@job-search-os/db";
import { resolveTargetUrl, safeError } from "../admin/common";
import { createLogger } from "../logger";
import { readPoolInboundConfig } from "../inbound/pool-mailbox";
import { safeDbError } from "../logging/safe-error";
import { formatReprocessReport, parseReprocessArgs, reprocessPoolQueue } from "./reprocess";

/**
 * Reprocesa la cola del pool con el lector de Computrabajo (R19-02):
 *   pnpm pool:reprocess [--limit N] [--dry-run] [--include-failed] [--remote]
 * Local por defecto. `--remote` pide escribir «si» en una terminal (CONFIRM_PRODUCTION no la saltea), igual
 * que pool:rehint. Con POOL_COMPUTRABAJO_READER apagado no escribe: solo sirve --dry-run.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const parsed = parseReprocessArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }
  const target = await resolveTargetUrl(
    parsed.remote,
    "reprocesar la cola del pool con el lector de Computrabajo",
  );
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }

  const conn = createDb(target.url, { max: 1 });
  try {
    console.log(`base: ${target.label}`);
    const result = await reprocessPoolQueue(conn.db, {
      limit: parsed.limit,
      dryRun: parsed.dryRun,
      includeFailed: parsed.includeFailed,
      readerEnabled: readPoolInboundConfig().computrabajoReader === true,
      logger: createLogger({ cmd: "pool:reprocess" }),
    });
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(formatReprocessReport(result));
  } finally {
    await conn.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  const e = safeDbError(error);
  console.error(
    `pool:reprocess falló: ${e.name}${e.code ? ` ${e.code}` : ""} (${safeError(error)})`,
  );
  process.exit(1);
});
