import { createDb, describeDatabaseUrl, loadLocalEnv, requireDatabaseUrl } from "@job-search-os/db";
import { dailyCapFromEnv, spendBreakdown, spendLast24h } from "./spend";

/**
 * Gasto LLM registrado en llm_calls.
 *   pnpm llm:spend [--local] [--days 7]
 * Muestra el acumulado de las últimas 24 h contra el tope (LLM_DAILY_CAP_USD) y el desglose
 * por día/tarea/modelo. Solo ve lo que pasó por el adapter con un sink de base de datos:
 * las corridas de evals NO escriben acá (usan un sink en memoria y su propio reporte).
 */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireDatabaseUrl({ purpose: "service" });
  const { db, close } = createDb(url, { max: 1 });
  try {
    console.log(`→ ${describeDatabaseUrl(url)}`);
    const days = Number(flag("days") ?? 7);
    const last = await spendLast24h(db);
    const cap = dailyCapFromEnv();
    console.log(
      `últimas 24 h: USD ${last.usd.toFixed(4)} en ${last.calls} llamadas (${last.failedCalls} fallidas, ${last.unpricedCalls} sin tarifa) · ${last.tokensIn} in / ${last.tokensOut} out (${last.tokensReasoning} thinking) · tope ${cap === 0 ? "desactivado" : `USD ${cap}`}`,
    );
    const rows = await spendBreakdown(db, new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    if (rows.length) console.table(rows.map((r) => ({ ...r, usd: Number(r.usd.toFixed(4)) })));
    else console.log(`(sin llamadas en los últimos ${days} días)`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("llm:spend falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
