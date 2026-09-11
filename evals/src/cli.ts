import { createInterface } from "node:readline/promises";
import { loadLocalEnv } from "@job-search-os/db";
import type { PromptRef } from "@job-search-os/prompts";
import { compareReports, loadReport } from "./compare";
import { recomputeFiles } from "./recompute";
import { generateFromEnv } from "@job-search-os/adapters";
import {
  estimateRunCostWithHistory,
  formatReport,
  parseThinkingFlag,
  runEvals,
  type CostEstimate,
} from "./run";

/**
 * pnpm evals run --prompt evaluate_job@v1 [--model gemini-3.5-flash] [--runs 3] [--concurrency 3]
 *   [--ids 1,2,33] [--subset] [--budget 150] [--force] [--label paso1] [--no-report]
 *   [--max-usd 1] [--yes] [--max-minutes 30] [--thinking minimal] [--db cloud|local|none]
 * pnpm evals compare reports/a.json reports/b.json
 * pnpm evals recompute reports/a.json [...]   (métricas y decide() sin llamar a la API)
 *
 * Guardarraíles de costo: antes de la primera llamada se muestra el costo estimado
 * (llamadas × tokens promedio × tarifa de model_routing); si supera --max-usd pide confirmación
 * (o aborta sin terminal, salvo --yes). La corrida tiene tope duro de --max-minutes y Ctrl+C /
 * SIGTERM cancelan las llamadas en curso y salen: no quedan procesos reintentando solos.
 */
function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string>;
  rest: string[];
} {
  const [command = "", ...args] = argv;
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      const v = inline ?? (args[i + 1] && !args[i + 1]!.startsWith("--") ? args[++i]! : "true");
      flags[k!] = v;
    } else rest.push(a);
  }
  return { command, flags, rest };
}

async function confirmCost(estimate: CostEstimate, maxUsd: number, yes: boolean) {
  const usd =
    estimate.usd === null ? "sin tarifa en model_routing" : `USD ${estimate.usd.toFixed(3)}`;
  process.stderr.write(
    `costo estimado: ${usd} (${estimate.calls} llamadas × ~${estimate.tokensInPerCall} in / ~${estimate.tokensOutPerCall} out, thinking incluido; fuente: ${estimate.source})\n`,
  );
  if (estimate.usd === null) {
    if (yes) return;
    throw new Error(
      "no hay tarifa para estimar el costo; cargá input/output_usd_per_mtok en seeds/model_routing.json o confirmá con --yes",
    );
  }
  if (estimate.usd <= maxUsd || yes) return;
  if (!process.stdin.isTTY) {
    throw new Error(
      `el costo estimado USD ${estimate.usd.toFixed(3)} supera --max-usd ${maxUsd} y no hay terminal para confirmar: pasá --yes o subí --max-usd`,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = (await rl.question(`supera --max-usd ${maxUsd}. ¿Seguir? [s/N] `))
    .trim()
    .toLowerCase();
  rl.close();
  if (answer !== "s" && answer !== "si" && answer !== "sí")
    throw new Error("corrida cancelada por costo");
}

async function main(): Promise<void> {
  loadLocalEnv();
  process.env.LOG_LEVEL ??= "warn";
  const { command, flags, rest } = parseArgs(process.argv.slice(2));

  if (command === "run") {
    const prompt = (flags.prompt ?? "evaluate_job@v1") as PromptRef;
    const options = {
      prompt,
      model: flags.model,
      runs: Number(flags.runs ?? 3),
      concurrency: Number(flags.concurrency ?? 3),
      ids: flags.ids ? flags.ids.split(",").map(Number) : undefined,
      outDir: flags["no-report"] ? "" : undefined,
      label: flags.label,
      subset: flags.subset === "true",
      budget: flags.budget ? Number(flags.budget) : undefined,
      force: flags.force === "true",
      thinking: parseThinkingFlag(flags.thinking),
      db: flags.db as "cloud" | "local" | "none" | undefined,
      generate: generateFromEnv(),
    };
    if (flags.local === "true") options.db = "local";
    await confirmCost(
      await estimateRunCostWithHistory(options),
      Number(flags["max-usd"] ?? 1),
      flags.yes === "true",
    );

    // Tope duro de la corrida + señales: nada queda vivo reintentando después de esto
    const controller = new AbortController();
    const maxMinutes = Number(flags["max-minutes"] ?? 30);
    const deadline = setTimeout(
      () => controller.abort(new Error(`tope de ${maxMinutes} min de corrida`)),
      maxMinutes * 60 * 1000,
    );
    // Sin unref a propósito: el tope mantiene vivo el proceso hasta que dispara o clearTimeout
    const onSignal = (sig: string) => {
      process.stderr.write(`\n${sig}: cancelando llamadas en curso\n`);
      controller.abort(new Error(sig));
      process.once("SIGINT", () => process.exit(130));
    };
    process.once("SIGINT", () => onSignal("SIGINT"));
    process.once("SIGTERM", () => onSignal("SIGTERM"));

    try {
      const report = await runEvals({ ...options, signal: controller.signal });
      console.log(formatReport(report));
      if (report.meta.calls > 0 && report.meta.calls_failed === report.meta.calls) {
        throw new Error(
          `las ${report.meta.calls} llamadas fallaron (timeout o proveedor caído): sin métricas`,
        );
      }
      const failing = report.thresholds.filter((t) => !t.ok);
      if (failing.length) {
        console.log(
          `\nUmbrales no cumplidos: ${failing.map((t) => `${t.name} (${t.value})`).join(" · ")}`,
        );
      }
    } finally {
      clearTimeout(deadline);
    }
    return;
  }

  if (command === "compare") {
    const [a, b] = rest;
    if (!a || !b) throw new Error("uso: pnpm evals compare <reporteA.json> <reporteB.json>");
    console.log(compareReports(loadReport(a), loadReport(b)));
    return;
  }

  if (command === "recompute") {
    if (!rest.length) throw new Error("uso: pnpm evals recompute <reporte.json> [más reportes]");
    for (const line of recomputeFiles(rest)) console.log(line);
    return;
  }

  throw new Error(`comando desconocido '${command}'. Usá run | compare | recompute`);
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  const abort =
    error instanceof Error &&
    (error.name === "FatalEvalError" ||
      error.name === "BudgetExceededError" ||
      error.name === "RunAbortedError");
  console.error(abort ? `evals ABORTADO: ${msg}` : `evals falló: ${msg}`);
  process.exit(1);
});
