import { readFileSync } from "node:fs";
import { createDb } from "./client";
import { confirmRemoteTarget } from "./confirm-remote";
import { describeDatabaseUrl, loadLocalEnv, requireDatabaseUrl } from "./env";

/**
 * Corre un archivo SQL revisado que ya trae su propia transacción (BEGIN … COMMIT), como el que
 * arma renorm-companies.ts (JS-086).
 *
 *   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file <archivo.sql> --ensayo
 *   pnpm --filter @job-search-os/db exec tsx src/run-sql-file.ts --file <archivo.sql>
 *
 * --ensayo cambia el último COMMIT por ROLLBACK: corre todo, incluida la guarda, y no deja nada.
 * Sin --ensayo, contra una base remota pide escribir "si" (o CONFIRM_PRODUCTION=si), igual que
 * db:migrate. Sin --local va contra Neon con la conexión dueña.
 */

/** Cambia el último COMMIT; del archivo por ROLLBACK;. Falla si no hay COMMIT final. */
export function asRehearsal(text: string): string {
  const re = /COMMIT;\s*$/;
  if (!re.test(text)) throw new Error("el archivo no termina en COMMIT;");
  return text.replace(re, "ROLLBACK;\n");
}

async function main(): Promise<void> {
  loadLocalEnv();
  const idx = process.argv.indexOf("--file");
  const file = idx > -1 ? process.argv[idx + 1] : undefined;
  if (!file)
    throw new Error("uso: tsx src/run-sql-file.ts [--local] --file <archivo.sql> [--ensayo]");
  const rehearsal = process.argv.includes("--ensayo");
  const original = readFileSync(file, "utf8");
  if (!/^\s*(--[^\n]*\n\s*)*BEGIN;/.test(original)) {
    throw new Error("el archivo tiene que abrir su propia transacción con BEGIN;");
  }
  const text = rehearsal ? asRehearsal(original) : original;
  const url = requireDatabaseUrl({ purpose: "migration" });
  console.error(
    `→ ${describeDatabaseUrl(url)} · ${rehearsal ? "ENSAYO (ROLLBACK)" : "APLICAR (COMMIT)"}`,
  );
  if (!rehearsal && !(await confirmRemoteTarget(url, { action: "aplicar SQL en" }))) {
    process.exitCode = 1;
    return;
  }
  const { sql, close } = createDb(url);
  try {
    await sql.unsafe(text);
    console.error(
      rehearsal
        ? "OK: el ensayo corrió entero y la guarda pasó. No quedó nada aplicado (ROLLBACK)."
        : "OK: aplicado (COMMIT).",
    );
  } finally {
    await close();
  }
}

if (process.argv[1]?.includes("run-sql-file")) {
  main().catch((error: unknown) => {
    console.error("run-sql-file falló:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
