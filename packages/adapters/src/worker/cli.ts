import {
  createDb,
  describeDatabaseUrl,
  loadLocalEnv,
  requireDatabaseUrl,
  schema as s,
} from "@job-search-os/db";
import { desc, eq } from "drizzle-orm";
import { createLlmClient } from "../llm/client";
import { createDemoLlm } from "../llm/demo";
import { generateFromEnv } from "../llm/fake";
import { drizzleCallSink } from "../llm/calls";
import { createProviderRegistry } from "../llm/providers";
import { cachedRouteSource, drizzleRouteSource } from "../llm/router";
import { dailyCapFromEnv } from "../llm/spend";
import { createLogger } from "../logger";
import { createPgQueue, EVALUATE_QUEUE } from "../queue/pg-queue";
import { runEvaluateWorker } from "./evaluate-job";

/**
 * Corrida manual del worker de evaluación (criterio de aceptación de JS-013).
 *   pnpm worker:evaluate [--local] [--limit 20] [--max-minutes 15] [--demo]
 * Requiere créditos del proveedor LLM (GEMINI_API_KEY), salvo --demo: evaluaciones falsas con
 * model = "fake" (badge DEMO en la UI), sin red ni gasto, contra la cola real.
 * Guardarraíles: tope de gasto LLM_DAILY_CAP_USD (24 h móviles), timeout por llamada
 * (LLM_CALL_TIMEOUT_MS), tope duro de la corrida (--max-minutes) y Ctrl+C / SIGTERM limpio:
 * cancela la llamada en curso, devuelve lo no procesado a la cola y cierra la conexión.
 */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadLocalEnv();
  process.env.LOG_LEVEL ??= "warn";
  const url = requireDatabaseUrl({ purpose: "service" });
  const { db, close } = createDb(url, { max: 2 });
  const logger = createLogger();

  const controller = new AbortController();
  const maxMinutes = Number(flag("max-minutes") ?? 15);
  const deadline = setTimeout(
    () => {
      console.error(`worker: tope de ${maxMinutes} min alcanzado, cancelando`);
      controller.abort(new Error("timeout de corrida"));
    },
    maxMinutes * 60 * 1000,
  );
  // Sin unref a propósito: el tope mantiene vivo el proceso hasta que dispara o clearTimeout
  const onSignal = (sig: string) => {
    console.error(`worker: ${sig} recibido, cancelando la llamada en curso`);
    controller.abort(new Error(sig));
    // Segunda señal: salir sin esperar
    process.once("SIGINT", () => process.exit(130));
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  try {
    console.log(`→ ${describeDatabaseUrl(url)} · tope 24 h: USD ${dailyCapFromEnv()}`);
    const queue = createPgQueue(db);
    console.log("cola antes:", JSON.stringify(await queue.stats(EVALUATE_QUEUE)));
    const demo = process.argv.includes("--demo") || process.env.LLM_DEMO === "1";
    if (demo)
      console.log("MODO DEMO: evaluaciones falsas (model = fake), sin llamadas al proveedor");
    const llm = demo
      ? createDemoLlm({ calls: drizzleCallSink(db) })
      : createLlmClient({
          routes: cachedRouteSource(drizzleRouteSource(db)),
          calls: drizzleCallSink(db),
          providers: createProviderRegistry(),
          logger,
          generate: generateFromEnv(),
        });
    const summary = await runEvaluateWorker(
      { db, llm, queue, logger, signal: controller.signal },
      { limit: flag("limit") ? Number(flag("limit")) : 20 },
    );
    const { outcomes, ...counts } = summary;
    console.log("worker:", JSON.stringify(counts));
    if (summary.stopped === "cap") {
      console.log(
        `FRENADO por tope de gasto: USD ${summary.spendUsd24h.toFixed(4)} en 24 h ≥ LLM_DAILY_CAP_USD=${summary.dailyCapUsd}. Los mensajes siguen pending.`,
      );
    }
    for (const o of outcomes) {
      console.log(
        o.ok
          ? `  ✓ ${o.jobId.slice(0, 8)} score ${o.score} → ${o.accion} (${o.status}) USD ${o.costUsd?.toFixed(4) ?? "?"}`
          : `  ✗ ${o.jobId.slice(0, 8)} ${o.retry}: ${o.error.slice(0, 160)}`,
      );
    }
    console.log("cola después:", JSON.stringify(await queue.stats(EVALUATE_QUEUE)));

    const rows = await db
      .select({
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        status: s.jobs.status,
        score: s.evaluations.score,
        accion: s.evaluations.accion,
        model: s.evaluations.model,
      })
      .from(s.evaluations)
      .innerJoin(s.jobs, eq(s.jobs.id, s.evaluations.jobId))
      .orderBy(desc(s.evaluations.createdAt))
      .limit(10);
    if (rows.length)
      console.table(
        rows.map((r) => ({ ...r, title: r.title.slice(0, 44), company: r.company.slice(0, 20) })),
      );
  } finally {
    clearTimeout(deadline);
    await close();
  }
  if (controller.signal.aborted) process.exitCode = 130;
}

main().catch((error: unknown) => {
  console.error("worker:evaluate falló:", error);
  process.exit(1);
});
