/**
 * Script de los e2e de personas (ronda 42), no un test: lo corre `computeRoleMarketAndPlan` de
 * flow.ts con `tsx` desde packages/adapters, porque Playwright carga los specs como CommonJS y el
 * índice de @job-search-os/db usa import.meta. Siempre contra la base local, sin LLM.
 * Uso: tsx compute-market.ts [userId]  (sin userId solo reconstruye el mercado por puesto).
 */
import {
  buildLearningPlan,
  buildRoleMarketSnapshots,
  recomputeMarketForUser,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";

async function main(): Promise<void> {
  const userId = process.argv[2];
  const url = requireDatabaseUrl({ purpose: "service", target: "local" });
  const { db, close } = createDb(url, { max: 2 });
  try {
    const market = await buildRoleMarketSnapshots(db);
    console.log(`mercado por puesto: ${market.roles} puestos, ${market.rows} filas`);
    if (!userId) return;
    const result = await recomputeMarketForUser(db, { userId, inputsChanged: true });
    // Con el límite de 10 s puede no correr: el plan se arma igual, con el mercado ya calculado
    const plan = await buildLearningPlan(db, { userId });
    console.log(
      `recálculo: ${result.ran ? "corrió" : `no corrió (${result.reason})`}; plan: ${plan.rows.length} skills (${plan.demandSource})`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("compute-market falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
