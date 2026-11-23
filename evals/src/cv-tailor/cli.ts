import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CV_TAILOR_PROMPT,
  CV_TAILOR_RESERVE_USD,
  CV_TAILOR_TASK,
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
  CvTailorOutputSchema,
  buildCvDocument,
  buildCvTailorPromptVars,
  checkCvTailorCase,
  cvTailorWire,
  parseCvTailorGolden,
  summarizeCvTailorChecks,
  verifyCvTailor,
  type CvTailorCaseCheck,
} from "@job-search-os/pipeline";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import { checkEstimate, createSpendGuard } from "../cost-guard";

/**
 * Harness de `cv_tailor` v1 (R20-04). Desde `evals/`:
 *
 *   pnpm exec tsx src/cv-tailor/cli.ts [--modo demo|modelo] [--ids a,b] [--runs 1] [--max-usd 3] [--dry-run]
 *     [--no-report]
 *
 * - `--modo demo` (por defecto): el modelo simulado de `LLM_DEMO`, sin red y sin gasto. Sirve para probar el
 *   circuito: lo que devuelve es de juguete y no dice nada del modelo real.
 * - `--modo modelo`: el modelo real de `model_routing` (`cv_tailor`), **sin respaldo**, como los demás evals.
 *   **Gasta**: lo corre Mauro. El tope `--max-usd` (por defecto 3) corta antes de la llamada que lo pasaría;
 *   con el estimado previo sobre el tope no se corre.
 * - Cada salida pasa por `verifyCvTailor`, igual que en producción, y se puntúa contra lo esperado del caso.
 *   Informa siempre: estricta, laxa, descartadas por la verificación e inseguras (tiene que dar 0). El reporte
 *   guarda solo veredictos y motivos de rechazo, nunca el texto del modelo.
 *
 * El golden son 8 casos inventados (`evals/fixtures/cv-tailor/golden.json`).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, "../../fixtures/cv-tailor/golden.json");
const REPORTS_DIR = resolve(HERE, "../../reports/cv-tailor");
const DEFAULT_MAX_USD = 3;
// Catálogo de juguete para el verificador: lo que en producción sale de la tabla `skills`
const KNOWN_TERMS = [
  "sql",
  "excel",
  "python",
  "power bi",
  "tableau",
  "docker",
  "kubernetes",
  "terraform",
  "aws",
  "node.js",
  "javascript",
  "wordpress",
  "mailchimp",
  "google analytics",
  "zendesk",
  "crm",
];

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
function tailorRoute(): RouteConfig {
  const r = routingSeed.find((x) => x.task === CV_TAILOR_TASK);
  if (!r) throw new Error(`seeds/model_routing.json no tiene ${CV_TAILOR_TASK}`);
  return {
    task: CV_TAILOR_TASK,
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

  const parsed = parseCvTailorGolden(JSON.parse(readFileSync(GOLDEN_PATH, "utf8")));
  if (!parsed.ok) throw new Error(parsed.error);
  const ids = flags.ids ? flags.ids.split(",").map((s) => s.trim()) : null;
  const golden = parsed.value.filter((g) => !ids || ids.includes(g.id));
  if (golden.length === 0) throw new Error("ningún caso para correr (revisá --ids)");

  const route = tailorRoute();
  const calls = golden.length * runs;
  // Estimado con la reserva de producción: es el máximo de un pedido (con respaldo), más que el promedio real
  const estimateUsd = calls * CV_TAILOR_RESERVE_USD;
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
          logger: createLogger({ run_id: `evals-cv-tailor-${Date.now()}` }),
          generate: generateFromEnv(),
        });
  const guard = createSpendGuard(
    mode === "modelo" ? maxUsd : Number.POSITIVE_INFINITY,
    CV_TAILOR_RESERVE_USD,
  );

  const rows: { id: string; run: number; reason: string | null; check: CvTailorCaseCheck }[] = [];
  let cut = false;
  outer: for (let run = 0; run < runs; run++) {
    for (const g of golden) {
      if (!guard.canStart()) {
        cut = true;
        break outer;
      }
      const cv = buildCvDocument(
        {
          ...g.cv,
          skills: g.cv.skills.map((s) => ({ name: s.name, category: s.category ?? null })),
        },
        { lang: "es", includeEmail: false },
      );
      guard.started();
      const r = await llm.generateStructured(
        CV_TAILOR_TASK,
        CvTailorOutputSchema,
        buildCvTailorPromptVars({ cv, job: g.job }),
        { promptVersion: CV_TAILOR_PROMPT, label: "r20-cv-tailor", wire: cvTailorWire },
      );
      guard.finished(r.ok ? r.value.costUsd : null);
      if (!r.ok) {
        rows.push({
          id: g.id,
          run,
          reason: `llamada:${r.error.kind}`,
          check: {
            rejected: true,
            unsafe: false,
            strict: false,
            lax: false,
            failures: [`falló la llamada (${r.error.kind})`],
          },
        });
        process.stderr.write(`  ${g.id}: falló la llamada (${r.error.kind})\n`);
        continue;
      }
      // Igual que en producción: lo del modelo solo cuenta si la verificación lo deja pasar
      const verified = verifyCvTailor(cv, r.value.object, { knownTerms: KNOWN_TERMS });
      const check = checkCvTailorCase(g.expect, verified.ok ? verified.value.document : null);
      rows.push({ id: g.id, run, reason: verified.ok ? null : verified.error.reason, check });
      process.stderr.write(
        `  ${g.id}: ${verified.ok ? "aceptada" : `descartada (${verified.error.reason})`} → ${
          check.unsafe ? "INSEGURA" : check.strict ? "estricto" : check.lax ? "laxo" : "falla"
        }\n`,
      );
    }
  }

  const summary = summarizeCvTailorChecks(rows.map((r) => r.check));
  const pct = (x: number | null) => (x === null ? "s/d" : `${(x * 100).toFixed(0)}%`);
  process.stdout.write(
    [
      `cv_tailor v1 · modo ${mode} · ${summary.n} llamada(s) · gasto USD ${guard.spent().toFixed(4)}`,
      `estricta: ${summary.strict}/${summary.n} (${pct(summary.strictRate)})`,
      `laxa (viñeta entre las dos primeras): ${summary.lax}/${summary.n} (${pct(summary.laxRate)})`,
      `descartadas por la verificación: ${summary.rejected}/${summary.n}`,
      `inseguras (aceptadas con un dato prohibido; tiene que dar 0): ${summary.unsafe}/${summary.n}`,
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
      `${JSON.stringify({ mode, prompt: CV_TAILOR_PROMPT, model: route.model, maxUsd, spentUsd: guard.spent(), cut, summary, rows }, null, 2)}\n`,
    );
    process.stderr.write(`reporte: evals/reports/cv-tailor/${name}\n`);
  }
  if (cut) process.exitCode = 2;
  if (summary.unsafe > 0) process.exitCode = 3;
}

main().catch((e: unknown) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
