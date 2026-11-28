import { createDb, describeDatabaseUrl, loadLocalEnv, requireDatabaseUrl } from "@job-search-os/db";
import { parseReevaluationMaxUsd } from "@job-search-os/pipeline";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { createLlmClient, DEFAULT_PROMPT_VERSIONS } from "../llm/client";
import { createDemoLlm } from "../llm/demo";
import { drizzleCallSink } from "../llm/calls";
import { generateFromEnv } from "../llm/fake";
import { createProviderRegistry } from "../llm/providers";
import { cachedRouteSource, drizzleRouteSource } from "../llm/router";
import { createLogger } from "../logger";
import { fileReevalStore } from "./file-store";
import { rollbackReevaluation, runReevaluation } from "./run";

/**
 * Reevaluación única de las ofertas abiertas con la versión nueva de `evaluate_job` (R31-09). **No se corre en la
 * tanda**: la corre el responsable cuando la versión nueva ya está promovida y `JOB_CARD` encendida.
 *
 *   pnpm --filter @job-search-os/adapters exec tsx src/reevaluate/reevaluate-cli.ts [--local]
 *       [--prompt evaluate_job@v1.5.0] [--limit N] [--state archivo.json]
 *       [--execute --max-usd N]            (sin --execute es un dry-run: cuenta y estima, no llama a nadie)
 *       [--rollback [--execute]]            (vuelve atrás lo hecho por la corrida del archivo de estado)
 *
 * - Dry-run por defecto: cuántas son, cuánto cuesta, sin llamar al modelo y sin escribir nada.
 * - `--execute` exige `--max-usd` (tope de gasto de ESTA corrida, hasta USD 50). Frena al llegar y se retoma con
 *   el mismo comando: el archivo de estado (por defecto `ops/reevaluacion/estado-<versión>.json`, sin versionar)
 *   dice qué ofertas ya se hicieron y guarda la evaluación anterior de cada una.
 * - Contra una base remota pide escribir «si» (o `CONFIRM_PRODUCTION=si`), como `db:migrate`.
 * - `--demo` (o `LLM_DEMO=1`): modelo simulado, sin gasto.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

async function confirmRemote(url: string): Promise<boolean> {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // una URL ilegible se trata como remota
  }
  if (LOCAL_HOSTS.has(host)) return true;
  if (process.env.CONFIRM_PRODUCTION === "si") return true;
  if (!process.stdin.isTTY) {
    console.error(
      `✗ Destino remoto (${host || "?"}) y no hay terminal para confirmar: no se hace nada.\n` +
        `  Para la base local: --local. Si de verdad es producción: CONFIRM_PRODUCTION=si.`,
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Vas a escribir en PRODUCCIÓN (${host}). Escribí 'si': `);
    return answer.trim().toLowerCase() === "si";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  process.env.LOG_LEVEL ??= "warn";
  const execute = has("execute");
  const rollback = has("rollback");
  const promptVersion = flag("prompt") ?? DEFAULT_PROMPT_VERSIONS.evaluate_job!;
  const statePath = resolve(
    flag("state") ??
      join(
        repoRoot(),
        "ops",
        "reevaluacion",
        `estado-${promptVersion.replace(/[^a-z0-9.@_-]/gi, "_")}.json`,
      ),
  );

  let maxUsd: number | undefined;
  if (execute && !rollback) {
    const parsed = parseReevaluationMaxUsd(flag("max-usd"));
    if (!parsed.ok) {
      console.error(
        parsed.error === "falta"
          ? "✗ --execute exige --max-usd <USD>: el tope de gasto es obligatorio."
          : "✗ --max-usd tiene que ser un número mayor que 0 y de hasta USD 50.",
      );
      process.exit(2);
    }
    maxUsd = parsed.value;
  } else if (flag("max-usd")) {
    const parsed = parseReevaluationMaxUsd(flag("max-usd"));
    if (parsed.ok) maxUsd = parsed.value;
  }

  const url = requireDatabaseUrl({ purpose: "service" });
  console.log(`→ ${describeDatabaseUrl(url)}`);
  console.log(
    `  modo: ${execute ? "EJECUTAR" : "dry-run (no llama a nadie ni escribe)"} · estado: ${statePath}`,
  );
  if (execute && !(await confirmRemote(url))) process.exit(3);

  const { db, close } = createDb(url, { max: 2 });
  const logger = createLogger();
  const store = fileReevalStore(statePath);
  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.error("reevaluate: SIGINT, se frena después de la oferta en curso");
    controller.abort(new Error("SIGINT"));
    process.once("SIGINT", () => process.exit(130));
  });
  try {
    if (rollback) {
      const r = await rollbackReevaluation({ db, store, logger }, { execute });
      if (!r.ok) {
        console.error("✗ no hay archivo de estado: no hay nada que volver atrás");
        process.exit(2);
      }
      console.log(JSON.stringify(r.value, null, 2));
      if (!execute) console.log("dry-run: agregá --execute para volver atrás de verdad");
      return;
    }
    const demo = has("demo") || process.env.LLM_DEMO === "1";
    const llm = demo
      ? createDemoLlm({ calls: drizzleCallSink(db) })
      : createLlmClient({
          routes: cachedRouteSource(drizzleRouteSource(db)),
          calls: drizzleCallSink(db),
          providers: createProviderRegistry(),
          logger,
          generate: generateFromEnv(),
        });
    const result = await runReevaluation(
      { db, llm, logger, store, signal: controller.signal },
      {
        promptVersion,
        execute,
        ...(maxUsd !== undefined ? { maxUsd } : {}),
        ...(flag("limit") ? { limit: Number(flag("limit")) } : {}),
      },
    );
    if (!result.ok) {
      console.error(`✗ ${result.error.kind}`);
      process.exit(2);
    }
    const { comparison, ...report } = result.value;
    console.log(JSON.stringify(report, null, 2));
    if (!execute) {
      console.log(
        `dry-run: para ejecutar, --execute --max-usd <USD> (el estimado es USD ${report.estimatedUsd?.toFixed(3) ?? "?"})`,
      );
    } else {
      console.table(
        comparison.map((c) => ({ oferta: c.jobId.slice(0, 8), antes: c.before, despues: c.after })),
      );
      if (report.stopped)
        console.log(
          `FRENADO (${report.stopped}): quedan ${report.remaining}. Volvé a correr el mismo comando para retomar.`,
        );
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`reevaluate falló: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
