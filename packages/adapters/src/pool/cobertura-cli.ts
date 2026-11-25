import {
  createDb,
  describeDatabaseUrl,
  loadLocalEnv,
  localDatabaseUrl,
  resolveDatabaseUrl,
} from "@job-search-os/db";
import { safeDbError } from "../logging/safe-error";
import { explainDatabaseUrl, inReadOnlyTransaction } from "./explain";
import {
  formatRoleLanguageCoverage,
  parseCoverageArgs,
  readRoleLanguageCoverage,
} from "./role-coverage";

/**
 * Cobertura del pool por carrera y por idioma (R28-06), solo lectura:
 *   pnpm pool:cobertura --local [--db dev|snapshot]     (o con DB_TARGET=local)
 *   pnpm pool:cobertura --solo-lectura                   (base remota; lo corre Admin, ver pasos manuales R28)
 * Sin `--local` ni `DB_TARGET=local` falla salvo que se pase `--solo-lectura` explícito. La sesión corre en
 * una transacción READ ONLY y el informe lleva solo conteos agregados (celdas de 1 a 4 como «<5»).
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const parsed = parseCoverageArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  let url: string | undefined;
  let label: string;
  if (parsed.target.kind === "local") {
    const local = explainDatabaseUrl(localDatabaseUrl(), parsed.target.db);
    if (!local.ok) {
      console.error(local.error);
      process.exitCode = 1;
      return;
    }
    url = local.url;
    label = `${parsed.target.db === "dev" ? "jobsearch" : "jobsearch_snapshot"} (localhost, solo lectura)`;
  } else {
    url = resolveDatabaseUrl({ purpose: "app", target: "cloud" });
    if (!url) {
      console.error("no hay URL de base remota en el entorno (DATABASE_URL_APP o DATABASE_URL)");
      process.exitCode = 1;
      return;
    }
    label = `remota ${describeDatabaseUrl(url).replace(/^[^@]*@/, "")} (solo lectura)`;
  }

  const conn = createDb(url, { max: 1 });
  try {
    const now = new Date();
    const rows = await inReadOnlyTransaction(conn.db, (tx) => readRoleLanguageCoverage(tx, now));
    console.log(formatRoleLanguageCoverage(rows, { label, asOf: now }));
  } finally {
    await conn.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  const e = safeDbError(error);
  console.error(`pool:cobertura falló: ${e.name}${e.code ? ` ${e.code}` : ""}`);
  process.exit(1);
});
