import { createDb, loadLocalEnv } from "@job-search-os/db";
import { resolveTargetUrl, safeError } from "../admin/common";
import { safeDbError } from "../logging/safe-error";
import { backfillJobLanguage } from "./backfill-language";

/**
 * Rellena el idioma y el nivel de inglés de `public_jobs` (C8-15, después de aplicar la 0058):
 *   pnpm pool:backfill-language [--apply] [--remote]
 * Local por defecto. `--remote` pide escribir «si» en una terminal. Sin `--apply` solo cuenta las filas
 * pendientes. Idempotente: solo toca las filas con `language_checked_at` null.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--apply" && a !== "--remote");
  if (unknown.length) {
    console.error(`argumento desconocido: ${unknown.join(" ")} (usá --apply y/o --remote)`);
    process.exitCode = 1;
    return;
  }
  const target = await resolveTargetUrl(args.includes("--remote"), "rellenar el idioma del pool");
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }
  const conn = createDb(target.url, { max: 1 });
  try {
    console.log(`base: ${target.label}`);
    const report = await backfillJobLanguage(conn.db, { apply: args.includes("--apply") });
    console.log(`pendientes antes: ${report.pending}`);
    console.log(
      args.includes("--apply")
        ? `escritas: ${report.written} filas en ${report.batches} tandas`
        : "(nada escrito: agregá --apply)",
    );
  } finally {
    await conn.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  const e = safeDbError(error);
  console.error(
    `pool:backfill-language falló: ${e.name}${e.code ? ` ${e.code}` : ""} (${safeError(error)})`,
  );
  process.exit(1);
});
