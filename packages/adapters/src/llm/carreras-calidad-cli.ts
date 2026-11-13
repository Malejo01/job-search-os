import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadLocalEnv } from "@job-search-os/db";
import { DEFAULT_PROMPT_VERSIONS } from "./client";
import { createLlmClient } from "./client";
import { memoryCallSink } from "./calls";
import { createLogger } from "../logger";
import { createProviderRegistry, providerForModel } from "./providers";
import { parseThinkingLevel, staticRouteSource } from "./router";
import type { RouteConfig } from "./types";
import {
  buildProfile,
  estimateUsd,
  formatMarkdown,
  runCalidad,
  selectCases,
  type CarreraDoc,
  type PersonaDePrueba,
} from "./carreras-calidad";

/**
 * R9-6 · Calidad de la evaluación por carrera con el modelo real.
 *
 *   Estimar sin llamar (por defecto, sin costo):
 *     pnpm --filter @job-search-os/adapters exec tsx src/llm/carreras-calidad-cli.ts
 *   Correr de verdad (PAGO; lo corre Mauro con `!`):
 *     pnpm --filter @job-search-os/adapters exec tsx src/llm/carreras-calidad-cli.ts --run --max-usd 1 --out calidad-carreras-r9.json
 *
 * Flags: --run (sin esto es dry-run), --max-usd N (tope duro, default 1; si el estimado lo supera no
 * llama), --per-carrera N (default 3), --model <id> (default: el de `evaluate_job` en el seed),
 * --out <archivo.json>. No escribe en ninguna base: las llamadas quedan en memoria. No usa
 * `evals/fixtures/golden.json`. Con `LLM_DAILY_CAP_USD` no tiene relación: el tope es el de acá.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** carrera del golden → clave de persona de `apps/web/e2e/personas/` (RR.PP. usa la de comunicación). */
const PERSONA_DE_CARRERA: Record<string, string> = {
  abogacia: "mariana",
  administracion_empresas: "bruno",
  comunicacion: "camila",
  finanzas_contabilidad: "agustina",
  fullstack: "julian",
  marketing_digital: "valentina",
  relaciones_internacionales: "ines",
  relaciones_publicas: "camila",
};
const CARRERAS = Object.keys(PERSONA_DE_CARRERA);

/** Tokens por evaluación medidos en evals (gemini-3.5-flash, minimal); otros modelos: supuesto igual. */
const TOKENS_POR_LLAMADA = { in: 4_100, out: 450 };

type SeedRow = {
  task: string;
  provider: string;
  model: string;
  fallback_model: string | null;
  temperature: number;
  max_tokens: number;
  thinking_level: string | null;
  input_usd_per_mtok: number | null;
  output_usd_per_mtok: number | null;
  fallback_input_usd_per_mtok: number | null;
  fallback_output_usd_per_mtok: number | null;
};

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

function priceFor(seed: SeedRow[], model: string): { input: number; output: number } | null {
  for (const r of seed) {
    if (r.model === model && r.input_usd_per_mtok !== null && r.output_usd_per_mtok !== null) {
      return { input: r.input_usd_per_mtok, output: r.output_usd_per_mtok };
    }
    if (
      r.fallback_model === model &&
      r.fallback_input_usd_per_mtok !== null &&
      r.fallback_output_usd_per_mtok !== null
    ) {
      return { input: r.fallback_input_usd_per_mtok, output: r.fallback_output_usd_per_mtok };
    }
  }
  return null;
}

async function main(): Promise<void> {
  loadLocalEnv();
  process.env.LOG_LEVEL ??= "warn";
  const argv = process.argv.slice(2);
  const run = argv.includes("--run");
  const maxUsd = Number(flag(argv, "max-usd") ?? 1);
  const perCarrera = Number(flag(argv, "per-carrera") ?? 3);
  const out = flag(argv, "out");
  if (!(maxUsd > 0) || maxUsd > 2) throw new Error("--max-usd tiene que estar entre 0 y 2");
  if (!Number.isInteger(perCarrera) || perCarrera < 1 || perCarrera > 4) {
    throw new Error("--per-carrera tiene que ser un entero de 1 a 4");
  }

  const seed = JSON.parse(
    readFileSync(resolve(ROOT, "packages/db/seeds/model_routing.json"), "utf8"),
  ) as SeedRow[];
  const base = seed.find((r) => r.task === "evaluate_job");
  if (!base) throw new Error("model_routing.json no tiene evaluate_job");
  const model = flag(argv, "model") ?? base.model;
  const price = priceFor(seed, model);
  if (!price)
    throw new Error(`sin tarifa en el seed para ${model}: no se puede garantizar el tope`);
  const promptRef = DEFAULT_PROMPT_VERSIONS.evaluate_job ?? "evaluate_job@v1";

  const docs = CARRERAS.map(
    (c) =>
      JSON.parse(
        readFileSync(resolve(ROOT, `packages/pipeline/test/fixtures/carreras/${c}.json`), "utf8"),
      ) as CarreraDoc,
  );
  const cases = docs.flatMap((d) => selectCases(d, perCarrera));
  const expectedCallUsd = estimateUsd(1, TOKENS_POR_LLAMADA, price);
  const estimate = estimateUsd(cases.length, TOKENS_POR_LLAMADA, price);

  console.error(
    `modelo ${model} (${promptRef}) · ${cases.length} avisos en ${docs.length} carreras · estimado USD ${estimate.toFixed(3)} (~${TOKENS_POR_LLAMADA.in} in / ~${TOKENS_POR_LLAMADA.out} out por llamada, tarifa del seed) · tope USD ${maxUsd}`,
  );
  if (!run) {
    console.error("dry-run: no se llamó a ningún modelo. Para correr de verdad agregá --run.");
    for (const d of docs) {
      console.error(
        `  ${d.meta.carrera} (${PERSONA_DE_CARRERA[d.meta.carrera]}): ${selectCases(d, perCarrera)
          .map((c) => c.id)
          .join(", ")}`,
      );
    }
    return;
  }
  if (estimate > maxUsd) {
    throw new Error(
      `el estimado USD ${estimate.toFixed(3)} supera --max-usd ${maxUsd}: no se llama a nadie`,
    );
  }

  // Personas y nombres de skills del e2e (datos inventados). Import dinámico: el archivo es de la app web
  const personasUrl = pathToFileURL(resolve(ROOT, "apps/web/e2e/personas/personas.ts")).href;
  const mod = (await import(personasUrl)) as {
    buildPersona: (key: string, tag?: number) => PersonaDePrueba & { role: string };
    SKILL_NAMES: Record<string, string>;
  };
  const personas: Record<string, PersonaDePrueba> = {};
  for (const key of new Set(Object.values(PERSONA_DE_CARRERA))) {
    const p = mod.buildPersona(key, 0);
    personas[key] = { key, role: p.role, cefr: p.cefr, skills: p.skills };
  }
  const roleSkills = JSON.parse(
    readFileSync(resolve(ROOT, "packages/db/seeds/role_skills.json"), "utf8"),
  ) as Record<string, { label: string }>;
  const roleLabels = Object.fromEntries(Object.entries(roleSkills).map(([k, v]) => [k, v.label]));
  const rules = JSON.parse(
    readFileSync(resolve(ROOT, "packages/db/seeds/criteria.example.json"), "utf8"),
  );

  const route: RouteConfig = {
    task: "evaluate_job",
    provider: providerForModel(model, base.provider),
    model,
    fallbackModel: null,
    temperature: base.temperature,
    maxTokens: base.max_tokens,
    thinkingLevel: parseThinkingLevel(base.thinking_level),
    inputUsdPerMtok: price.input,
    outputUsdPerMtok: price.output,
    fallbackInputUsdPerMtok: null,
    fallbackOutputUsdPerMtok: null,
  };
  const calls = memoryCallSink();
  const llm = createLlmClient({
    routes: staticRouteSource([route]),
    calls,
    providers: createProviderRegistry(),
    logger: createLogger({ run_id: `calidad-carreras-${Date.now()}` }),
  });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error("tope de 15 min")), 15 * 60_000);
  process.once("SIGINT", () => controller.abort(new Error("SIGINT")));
  process.once("SIGTERM", () => controller.abort(new Error("SIGTERM")));
  try {
    const summary = await runCalidad(
      {
        llm,
        rules,
        promptRef,
        skillNames: mod.SKILL_NAMES,
        roleLabels,
        personas,
        personaDeCarrera: PERSONA_DE_CARRERA,
        maxUsd,
        expectedCallUsd,
        signal: controller.signal,
      },
      docs,
      perCarrera,
      (doc, persona) =>
        buildProfile(
          doc,
          persona,
          mod.SKILL_NAMES,
          roleLabels[doc.meta.carrera] ?? doc.meta.carrera,
        ),
    );
    console.log(formatMarkdown(summary, { modelo: model, prompt: promptRef }));
    if (out) writeFileSync(resolve(process.cwd(), out), JSON.stringify(summary, null, 2) + "\n");
    if (summary.cortadoPorTope) process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}

main().catch((error: unknown) => {
  console.error("calidad-carreras falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
