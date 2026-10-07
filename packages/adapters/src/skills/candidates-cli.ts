import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDb,
  describeDatabaseUrl,
  loadLocalEnv,
  requireDatabaseUrl,
  schema as s,
} from "@job-search-os/db";
import routing from "@job-search-os/db/seeds/model_routing.json";
import {
  err,
  extractSkillsFromText,
  extractSkillsOutputSchema,
  normalizeExtracted,
  ok,
  skillCandidates,
  type SkillCandidate,
  type Term,
} from "@job-search-os/pipeline";
import { and, eq, isNotNull } from "drizzle-orm";
import type { LlmClient } from "../llm/types";
import { loadTaxonomy } from "./sync";

/**
 * pnpm --filter @job-search-os/adapters exec tsx src/skills/candidates-cli.ts --local [--min 2] [--top 40] [--user <uuid>] [--llm]
 * Candidatos a skill nueva sobre las JD ya cargadas (JS-030). Determinista, sin LLM, solo lectura.
 * Imprime términos y conteos, nunca texto de avisos.
 * --local es obligatorio: esta herramienta no corre contra producción.
 * --llm: corre `extract_skills` sobre hasta 5 JD, SOLO con LLM_DEMO=1 (cliente falso, costo 0).
 * Sin demo aborta e imprime el estimado de costo del backfill real.
 */

export type CliArgs = {
  local: boolean;
  llm: boolean;
  min: number;
  top: number;
  userId: string | null;
};

const DEFAULT_MIN = 2;
const DEFAULT_TOP = 40;
/** Cuántas JD toma el modo --llm de demo. */
export const DEMO_JD_LIMIT = 5;
/** Supuestos del estimado: tokens por JD (entrada con prompt, salida con la lista). */
export const TOKENS_IN_PER_JD = 2000;
export const TOKENS_OUT_PER_JD = 300;

export function parseArgs(argv: readonly string[]): CliArgs {
  const value = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };
  const positive = (raw: string | null, fallback: number): number => {
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    local: argv.includes("--local"),
    llm: argv.includes("--llm"),
    min: positive(value("min"), DEFAULT_MIN),
    top: positive(value("top"), DEFAULT_TOP),
    userId: value("user"),
  };
}

export type RunMode =
  | { kind: "abort"; message: string }
  | { kind: "candidates" }
  | { kind: "llm_demo" }
  | { kind: "llm_estimate" };

/** Decide qué hace la corrida sin tocar nada: sin --local aborta; --llm sin demo solo estima. */
export function decideMode(args: CliArgs, env: Record<string, string | undefined>): RunMode {
  if (!args.local) {
    return {
      kind: "abort",
      message: "falta --local: skills:candidates solo corre contra la base local (no producción)",
    };
  }
  if (!args.llm) return { kind: "candidates" };
  return env.LLM_DEMO === "1" ? { kind: "llm_demo" } : { kind: "llm_estimate" };
}

type RouteRow = {
  task: string;
  model: string;
  input_usd_per_mtok: number | null;
  output_usd_per_mtok: number | null;
};

export type BackfillEstimate = {
  jdCount: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  usd: number | null;
};

/** Estimado del backfill real con la tarifa de model_routing; usd null si falta la tarifa. */
export function estimateBackfill(
  jdCount: number,
  routes: readonly RouteRow[] = routing as RouteRow[],
): BackfillEstimate | null {
  const route = routes.find((r) => r.task === "extract_skills");
  if (!route) return null;
  const tokensIn = jdCount * TOKENS_IN_PER_JD;
  const tokensOut = jdCount * TOKENS_OUT_PER_JD;
  const usd =
    route.input_usd_per_mtok === null || route.output_usd_per_mtok === null
      ? null
      : (tokensIn * route.input_usd_per_mtok + tokensOut * route.output_usd_per_mtok) / 1_000_000;
  return { jdCount, model: route.model, tokensIn, tokensOut, usd };
}

export function formatEstimate(e: BackfillEstimate | null): string[] {
  if (!e) return ["Sin fila `extract_skills` en model_routing: no hay estimado."];
  return [
    `Estimado del backfill real (no se corrió nada): ${e.jdCount} JD con texto`,
    `  ~${TOKENS_IN_PER_JD} tokens de entrada + ~${TOKENS_OUT_PER_JD} de salida por JD, modelo ${e.model}`,
    `  total ~${e.tokensIn} in / ~${e.tokensOut} out · ${
      e.usd === null ? "sin tarifa en model_routing" : `USD ${e.usd.toFixed(2)}`
    }`,
    "  --llm solo corre con LLM_DEMO=1 (cliente falso). El backfill real lo aprueba Mauro: ver backfill.md",
  ];
}

export function formatCandidates(
  candidates: readonly SkillCandidate[],
  info: { jdCount: number; min: number },
): string[] {
  const head = `${info.jdCount} JD con texto · candidatos con al menos ${info.min} apariciones`;
  if (!candidates.length) return [head, "(sin candidatos)"];
  const width = String(candidates[0]!.count).length;
  return [
    head,
    ...candidates.map((c) => {
      const variants = c.examples ? `  (${c.examples.join(" | ")})` : "";
      return `${String(c.count).padStart(width)}  ${c.term}${variants}`;
    }),
  ];
}

/** Solo las JD con texto no vacío. */
export function jdTexts(rows: readonly { jdText: string | null }[]): string[] {
  return rows.map((r) => r.jdText?.trim() ?? "").filter((t) => t.length > 0);
}

/**
 * Cliente falso de `extract_skills` para el modo --llm de esta ronda: skills de la taxonomía por
 * alias (known) más los candidatos técnicos (proposed), sin red ni gasto. Marcado DEMO.
 * El prompt real (extract_skills.v1) todavía no está en packages/prompts: el demo no lo necesita.
 */
export function createDemoExtractLlm(terms: readonly Term[]): LlmClient {
  return {
    async generateStructured(task, schema, vars) {
      if (task !== "extract_skills") {
        return err({ kind: "no_route", task, detail: "demo de skills: solo extract_skills" });
      }
      const job = String(vars.job ?? "");
      const known = extractSkillsFromText(job, terms).map((slug) => ({
        term: slug,
        slug,
        category: "demo",
        must: true,
      }));
      const proposed = skillCandidates([job], terms, { minCount: 1 }).map((c) => ({
        term: c.term,
        slug: null,
        category: "demo",
        must: false,
      }));
      const parsed = schema.safeParse({ skills: [...known, ...proposed] });
      if (!parsed.success) {
        return err({
          kind: "generation_failed",
          task,
          detail: "demo: la salida no cumple el schema",
        });
      }
      return ok({
        object: parsed.data,
        model: "fake",
        provider: "fake",
        promptVersion: "extract_skills@DEMO",
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        costUsd: 0,
        latencyMs: 0,
        usedFallback: false,
      });
    },
  };
}

export function formatExtraction(
  index: number,
  result: ReturnType<typeof normalizeExtracted>,
): string {
  if (!result.ok) return `JD ${index}: salida inválida (${result.error})`;
  const known = result.value.known.map((k) => `${k.slug}${k.must ? "" : "?"}`).join(", ");
  const proposed = result.value.proposed.map((p) => p.term).join(", ");
  return `JD ${index}: known [${known}] · proposed [${proposed}]`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = decideMode(args, process.env);
  if (mode.kind === "abort") {
    console.error(mode.message);
    process.exit(1);
  }
  loadLocalEnv();
  const url = requireDatabaseUrl({ purpose: "service", target: "local" });
  const { db, close } = createDb(url, { max: 2 });
  try {
    console.log(`→ ${describeDatabaseUrl(url)} (solo lectura)`);
    const rows = await db
      .select({ jdText: s.jobs.jdText, companyRaw: s.jobs.companyRaw })
      .from(s.jobs)
      .where(
        args.userId
          ? and(isNotNull(s.jobs.jdText), eq(s.jobs.userId, args.userId))
          : isNotNull(s.jobs.jdText),
      );
    const texts = jdTexts(rows);
    const terms = await loadTaxonomy(db);

    if (mode.kind === "llm_estimate") {
      console.error("--llm sin LLM_DEMO=1: no se llama a ningún modelo.");
      for (const line of formatEstimate(estimateBackfill(texts.length))) console.error(line);
      process.exit(1);
    }
    if (mode.kind === "llm_demo") {
      console.log("MODO DEMO: cliente falso (model = fake), sin llamadas al proveedor");
      const llm = createDemoExtractLlm(terms);
      let i = 0;
      for (const text of texts.slice(0, DEMO_JD_LIMIT)) {
        i += 1;
        const r = await llm.generateStructured("extract_skills", extractSkillsOutputSchema, {
          job: text,
        });
        console.log(
          r.ok
            ? formatExtraction(i, normalizeExtracted(r.value.object, terms))
            : `JD ${i}: ${r.error.detail}`,
        );
      }
      return;
    }

    const candidates = skillCandidates(texts, terms, {
      minCount: args.min,
      limit: args.top,
      // Los nombres de empresa se parecen a una tecnología: nunca son candidatos
      exclude: [...new Set(rows.map((r) => r.companyRaw))],
    });
    for (const line of formatCandidates(candidates, { jdCount: texts.length, min: args.min })) {
      console.log(line);
    }
  } finally {
    await close();
  }
}

// Solo corre como script, no al importarlo desde los tests
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error("skills:candidates falló:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
