import { createDb } from "./client";
import { describeDatabaseUrl, loadLocalEnv, requireDatabaseUrl } from "./env";

/**
 * Consulta ad hoc para verificar estado (no hay psql contra Neon):
 *   pnpm db:sql "select count(*) from jobs"          → nube (DATABASE_URL_UNPOOLED)
 *   pnpm db:sql --local "select count(*) from jobs"  → Docker
 *   pnpm db:sql --app "select count(*) from jobs"    → como la app (jobsearch_app, con RLS)
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const query = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"))
    .join(" ");
  if (!query) throw new Error('uso: pnpm db:sql [--local] "<sql>"');
  const purpose = process.argv.includes("--app") ? "app" : "migration";
  const url = requireDatabaseUrl({ purpose });
  const { sql, close } = createDb(url);
  try {
    console.error(`→ ${describeDatabaseUrl(url)}`);
    const rows = await sql.unsafe(query);
    if (rows.length) console.table(rows);
    else console.log(`(${rows.count ?? 0} filas afectadas)`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("db:sql falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
