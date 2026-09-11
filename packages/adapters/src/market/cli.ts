import { createDb, describeDatabaseUrl, loadLocalEnv, requireDatabaseUrl } from "@job-search-os/db";
import { buildMarketSnapshot } from "./snapshot";

/**
 * pnpm market:snapshot [--local] [--user <uuid>] [--week YYYY-MM-DD] [--since-days N]
 * Recalcula market_snapshots del usuario para la semana (default: la actual). Sin LLM.
 */
const DEFAULT_USER = "a0000000-0000-4000-8000-000000000001";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireDatabaseUrl({ purpose: "service" });
  const { db, close } = createDb(url, { max: 2 });
  try {
    console.log(`→ ${describeDatabaseUrl(url)}`);
    const sinceDays = flag("since-days") ? Number(flag("since-days")) : undefined;
    const result = await buildMarketSnapshot(db, {
      userId: flag("user") ?? process.env.SEED_USER_ID ?? DEFAULT_USER,
      weekStart: flag("week"),
      since: sinceDays ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) : undefined,
    });
    console.log(
      `semana ${result.weekStart}: ${result.jobs} ofertas con skills (${result.jobsWithoutScore} sin score, pesan 5), ${result.skills} skills`,
    );
    console.table(result.demand.slice(0, 15));
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("market:snapshot falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
