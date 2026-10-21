import { createDb, loadLocalEnv } from "@job-search-os/db";
import { resolveTargetUrl, safeError } from "../admin/common";
import { safeDbError } from "../logging/safe-error";
import { formatRehintReport, parseRehintArgs, rehintPool } from "./rehint";

/**
 * Recalcula `role_hints` y `lang` de las ofertas vigentes del pool (ronda 102):
 *   pnpm pool:rehint [--apply] [--remote]
 * Local por defecto. `--remote` pide escribir «si» en una terminal (CONFIRM_PRODUCTION no la saltea).
 * Sin `--apply` es un dry-run: muestra antes/después (solo conteos) y no escribe nada.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const parsed = parseRehintArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }
  const target = await resolveTargetUrl(parsed.remote, "recalcular role_hints y lang del pool");
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }

  const conn = createDb(target.url, { max: 1 });
  try {
    const report = await rehintPool(conn.db, { apply: parsed.apply, now: new Date() });
    console.log(`base: ${target.label}`);
    console.log(formatRehintReport(report));
    console.log(
      parsed.apply
        ? `\nescrito: ${report.rowsWritten} filas (role_hints en ${report.hintsChanged}, lang en ${report.langChanged})`
        : "\n(nada escrito: agregá --apply)",
    );
  } finally {
    await conn.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  const e = safeDbError(error);
  console.error(`pool:rehint falló: ${e.name}${e.code ? ` ${e.code}` : ""} (${safeError(error)})`);
  process.exit(1);
});
