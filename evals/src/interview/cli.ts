import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTERVIEW_FEEDBACK_PROMPT,
  INTERVIEW_FEEDBACK_RESERVE_USD,
  INTERVIEW_FEEDBACK_TASK,
  createDemoLlm,
  createLlmClient,
  createLogger,
  createProviderRegistry,
  generateFromEnv,
  memoryCallSink,
  parseThinkingLevel,
  providerForModel,
  staticRouteSource,
  type LlmClient,
  type RouteConfig,
} from "@job-search-os/adapters";
import {
  InterviewFeedbackOutputSchema,
  buildFeedbackPromptVars,
  checkInterviewFeedback,
  interviewFeedbackWire,
  parseInterviewGolden,
  prepareInterviewAnswer,
  summarizeInterviewChecks,
  type InterviewCaseCheck,
} from "@job-search-os/pipeline";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import { checkEstimate, createSpendGuard } from "../cost-guard";

/**
 * Harness de `interview_feedback` v1 (R17-08). Desde `evals/`:
 *
 *   pnpm exec tsx src/interview/cli.ts [--modo demo|modelo] [--ids a,b] [--runs 1] [--max-usd 2] [--dry-run]
 *     [--no-report]
 *
 * - `--modo demo` (por defecto): el modelo simulado de `LLM_DEMO`, sin red y sin gasto. Sirve para probar el
 *   circuito: sus puntajes son de juguete y no dicen nada del modelo real.
 * - `--modo modelo`: el modelo real de `model_routing` (`interview_feedback`), **sin respaldo**, como los demás
 *   evals. **Gasta**: lo corre Mauro. El tope `--max-usd` (por defecto 2) corta antes de la llamada que lo
 *   pasaría; con el estimado previo sobre el tope no se corre.
 * - Informa siempre las dos métricas: estricta (todo en rango) y laxa (cada puntaje a 1 punto del rango).
 *   El reporte guarda solo puntajes y veredictos, nunca el texto del modelo.
 *
 * El golden son 10 casos inventados (`evals/fixtures/interview/golden.json`).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, "../../fixtures/interview/golden.json");
const REPORTS_DIR = resolve(HERE, "../../reports/interview");
const DEFAULT_MAX_USD = 2;

type Flags = Record<string, string>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`argumento suelto: ${a}`);
    const [k, inline] = a.slice(2).split("=", 2);
    const v = inline ?? (argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true");
    flags[k!] = v;
  }
  return flags;
}

/** Ruta de la tarea, del seed y sin modelo de respaldo. */
function feedbackRoute(): RouteConfig {
  const r = routingSeed.find((x) => x.task === INTERVIEW_FEEDBACK_TASK);
  if (!r) throw new Error(`seeds/model_routing.json no tiene ${INTERVIEW_FEEDBACK_TASK}`);
  return {
    task: INTERVIEW_FEEDBACK_TASK,
    provider: providerForModel(r.model, r.provider),
    model: r.model,
    fallbackModel: null,
    temperature: r.temperature,
    maxTokens: r.max_tokens,
    thinkingLevel: parseThinkingLevel(r.thinking_level),
    inputUsdPerMtok: r.input_usd_per_mtok,
    outputUsdPerMtok: r.output_usd_per_mtok,
    fallbackInputUsdPerMtok: null,
    fallbackOutputUsdPerMtok: null,
  };
}

async function main(): Promise<void> {
  process.env.LOG_LEVEL ??= "warn";
  const flags = parseFlags(process.argv.slice(2));
  const mode = flags.modo ?? "demo";
  if (!["demo", "modelo"].includes(mode)) throw new Error("--modo: demo o modelo");
  const runs = Number(flags.runs ?? 1);
  if (!Number.isInteger(runs) || runs < 1 || runs > 3) throw new Error("--runs: 1 a 3");
  const maxUsd = Number(flags["max-usd"] ?? DEFAULT_MAX_USD);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("--max-usd: un número mayor que 0");

  const parsed = parseInterviewGolden(JSON.parse(readFileSync(GOLDEN_PATH, "utf8")));
  if (!parsed.ok) throw new Error(parsed.error);
  const ids = flags.ids ? flags.ids.split(",").map((s) => s.trim()) : null;
  const golden = parsed.value.filter((g) => !ids || ids.includes(g.id));
  if (golden.length === 0) throw new Error("ningún caso para correr (revisá --ids)");

  const route = feedbackRoute();
  const calls = golden.length * runs;
  // Estimado con la reserva de producción: es el máximo de una evaluación, más que el promedio real
  const estimateUsd = calls * INTERVIEW_FEEDBACK_RESERVE_USD;
  process.stderr.write(
    `plan: ${golden.length} caso(s) × ${runs} corrida(s), modo ${mode}; ` +
      `costo estimado como máximo con el modelo real (${route.model}): USD ${estimateUsd.toFixed(3)}\n`,
  );
  if (mode === "modelo") {
    const check = checkEstimate({ usd: estimateUsd, calls }, maxUsd);
    if (!check.ok) throw new Error(check.reason);
  }
  if (flags["dry-run"] === "true") {
    process.stderr.write("dry-run: no se llamó a nada\n");
    return;
  }

  const sink = memoryCallSink();
  const llm: LlmClient =
    mode === "demo"
      ? createDemoLlm({ calls: sink })
      : createLlmClient({
          routes: staticRouteSource([route]),
          calls: sink,
          providers: createProviderRegistry(),
          logger: createLogger({ run_id: `evals-interview-${Date.now()}` }),
          generate: generateFromEnv(),
        });
  const guard = createSpendGuard(
    mode === "modelo" ? maxUsd : Number.POSITIVE_INFINITY,
    INTERVIEW_FEEDBACK_RESERVE_USD,
  );

  const rows: {
    id: string;
    run: number;
    scores: [number, number, number] | null;
    check: InterviewCaseCheck;
  }[] = [];
  let cut = false;
  outer: for (let run = 0; run < runs; run++) {
    for (const g of golden) {
      if (!guard.canStart()) {
        cut = true;
        break outer;
      }
      const answer = prepareInterviewAnswer(g.answer);
      if (!answer.ok)
        throw new Error(`${g.id}: la respuesta del golden no pasa la limpieza (${answer.error})`);
      guard.started();
      const r = await llm.generateStructured(
        INTERVIEW_FEEDBACK_TASK,
        InterviewFeedbackOutputSchema,
        buildFeedbackPromptVars({
          context: g.context,
          question: g.question,
          answer: answer.value.text,
        }),
        {
          promptVersion: INTERVIEW_FEEDBACK_PROMPT,
          label: "r17-interview",
          wire: interviewFeedbackWire,
        },
      );
      guard.finished(r.ok ? r.value.costUsd : null);
      if (!r.ok) {
        rows.push({
          id: g.id,
          run,
          scores: null,
          check: { strict: false, lax: false, failures: [`falló la llamada (${r.error.kind})`] },
        });
        process.stderr.write(`  ${g.id}: falló la llamada (${r.error.kind})\n`);
        continue;
      }
      const o = r.value.object;
      const check = checkInterviewFeedback(g.expect, o);
      rows.push({ id: g.id, run, scores: [o.clarity, o.relevance, o.star], check });
      process.stderr.write(
        `  ${g.id}: claridad ${o.clarity}, relevancia ${o.relevance}, STAR ${o.star} → ${check.strict ? "estricto" : check.lax ? "laxo" : "falla"}\n`,
      );
    }
  }

  const summary = summarizeInterviewChecks(rows.map((r) => r.check));
  const pct = (x: number | null) => (x === null ? "s/d" : `${(x * 100).toFixed(0)}%`);
  process.stdout.write(
    [
      `interview_feedback v1 · modo ${mode} · ${summary.n} llamada(s) · gasto USD ${guard.spent().toFixed(4)}`,
      `estricta: ${summary.strict}/${summary.n} (${pct(summary.strictRate)})`,
      `laxa (±1): ${summary.lax}/${summary.n} (${pct(summary.laxRate)})`,
      ...rows
        .filter((r) => !r.check.strict)
        .map((r) => `  - ${r.id}: ${r.check.failures.join("; ")}`),
      cut ? `!! CORTADO por tope de gasto --max-usd ${maxUsd}: reporte parcial` : "",
      "",
    ]
      .filter((l, i, a) => l !== "" || i === a.length - 1)
      .join("\n"),
  );
  if (flags["no-report"] !== "true") {
    mkdirSync(REPORTS_DIR, { recursive: true });
    const name = `${new Date().toISOString().slice(0, 10)}_${mode}${cut ? "_cortado" : ""}.json`;
    writeFileSync(
      resolve(REPORTS_DIR, name),
      `${JSON.stringify({ mode, prompt: INTERVIEW_FEEDBACK_PROMPT, model: route.model, maxUsd, spentUsd: guard.spent(), cut, summary, rows }, null, 2)}\n`,
    );
    process.stderr.write(`reporte: evals/reports/interview/${name}\n`);
  }
  if (cut) process.exitCode = 2;
}

main().catch((e: unknown) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
