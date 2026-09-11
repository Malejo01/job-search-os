import { createDb, describeDatabaseUrl, loadLocalEnv, requireDatabaseUrl } from "@job-search-os/db";
import { buildLearningPlan } from "./plan";

/**
 * pnpm plan:build [--local] [--user <uuid>] [--week YYYY-MM-DD]
 * Sincroniza learning_plan_items con el último snapshot de mercado (JS-034). Sin LLM.
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
    const r = await buildLearningPlan(db, {
      userId: flag("user") ?? process.env.SEED_USER_ID ?? DEFAULT_USER,
      weekStart: flag("week"),
    });
    if (!r.weekStart) {
      console.log("sin snapshot de mercado: corré pnpm market:snapshot primero");
      return;
    }
    console.log(
      `plan desde la semana ${r.weekStart}: ${r.rows.length} skills · ${r.inserted} nuevas, ${r.updated} actualizadas, ${r.removed} quitadas`,
    );
    console.table(
      r.rows.slice(0, 15).map((x) => ({
        slug: x.slug,
        nivel: x.level ?? "-",
        demanda: x.weightedDemand,
        facilidad: x.ease,
        prioridad: x.priority,
        horas: x.hoursRemaining ?? "-",
      })),
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("plan:build falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
