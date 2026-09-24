import { err, ok } from "@job-search-os/pipeline";
import type { CallSink, GenerateContext, LlmClient } from "./types";

/**
 * Modo demo: evaluaciones falsas pero verosímiles, sin red ni gasto, para ver el flujo entero en
 * la UI y para los tests E2E (pnpm worker:evaluate --demo, LLM_DEMO=1 en el cron). Se distinguen
 * siempre: model = "fake" en evaluations y llm_calls, veredicto que lo dice, badge DEMO en la UI.
 * La heurística es deliberadamente tonta (palabras clave del texto del aviso): no reemplaza al
 * modelo, solo produce algo coherente con el schema y con el perfil.
 */
export const DEMO_MODEL = "fake";

type Vars = Record<string, string | number | boolean>;

const has = (text: string, ...words: string[]) =>
  words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));

export function demoEvaluation(vars: Vars): Record<string, unknown> {
  const job = String(vars.job ?? "");
  const text = job.toLowerCase();

  const strengths = [
    ["RAG", has(text, "rag", "retrieval")],
    ["agentes", has(text, "agent", "agentes", "agentic")],
    ["LLM/prompting", has(text, "llm", "gpt", "gemini", "claude", "prompt")],
    ["Python", has(text, "python")],
    ["TypeScript", has(text, "typescript", "node")],
    ["MCP", has(text, "mcp")],
    ["vector DB", has(text, "vector", "embeddings", "pgvector", "pinecone")],
  ]
    .filter(([, hit]) => hit)
    .map(([name]) => String(name));

  const gaps: { skill: string; nivel: "must" | "deseable" }[] = [];
  if (has(text, "aws", "gcp", "azure"))
    gaps.push({
      skill: "cloud",
      nivel: has(text, "deseable", "nice to have", "plus") ? "deseable" : "must",
    });
  if (has(text, "kubernetes", "k8s")) gaps.push({ skill: "Kubernetes", nivel: "deseable" });
  if (has(text, "go", "golang", "rust", "java"))
    gaps.push({ skill: "otro lenguaje principal", nivel: "must" });

  const yearsMatch = /(\d{1,2})\+?\s*(?:años|years|yrs)/i.exec(job);
  const years = yearsMatch ? Number(yearsMatch[1]) : null;

  const bloqueadores: string[] = [];
  if (years !== null && years >= 8) bloqueadores.push(`piden ${years}+ años de experiencia`);
  if (has(text, "presencial", "on-site", "onsite") && !has(text, "remoto", "remote"))
    bloqueadores.push("presencial");
  if (has(text, "us only", "usa only", "united states only", "solo estados unidos"))
    bloqueadores.push("solo residentes de EE.UU.");

  const riesgos: string[] = [];
  if (!/\$|usd|salario|salary/i.test(job)) riesgos.push("salario no publicado");
  if (has(text, "latam") && !has(text, "argentina")) riesgos.push("LATAM sin países listados");
  if (has(text, "staffing", "consultora", "agency")) riesgos.push("empresa de staffing");

  const locationOk: "ok" | "riesgo" | "no" = bloqueadores.some((b) => b.includes("EE.UU."))
    ? "no"
    : riesgos.some((r) => r.startsWith("LATAM"))
      ? "riesgo"
      : "ok";

  let score = 4 + strengths.length * 0.8 - gaps.filter((g) => g.nivel === "must").length * 0.7;
  score = Math.max(1, Math.min(9.5, Math.round(score * 2) / 2));
  const accion = bloqueadores.length
    ? "descartar"
    : score >= 7
      ? "aplicar"
      : score >= 5
        ? "guardar"
        : "descartar";

  return {
    score,
    confianza: "baja",
    years_required: years,
    location_ok: locationOk,
    modalidad: has(text, "remoto", "remote")
      ? "remoto"
      : has(text, "híbrido", "hybrid")
        ? "hibrido"
        : "desconocida",
    disciplina: has(text, "data scientist", "machine learning engineer", "ml engineer")
      ? "ml_engineer"
      : "ai_engineer",
    // v1.3.2: los años vienen con su dominio y su disciplina
    years_domain: years === null ? null : "desarrollo de software",
    years_discipline: years === null ? null : "ai_engineer",
    ingles_requerido: has(text, "inglés avanzado", "english advanced", "fluent english", "c1")
      ? "avanzado"
      : has(text, "inglés", "english")
        ? "intermedio"
        : "no_menciona",
    tipo_empresa: has(text, "staffing", "consultora")
      ? "staffing"
      : has(text, "startup")
        ? "startup"
        : "desconocido",
    paises_permitidos: null,
    match_fuerte: strengths.slice(0, 8),
    gaps: gaps.slice(0, 8),
    bloqueadores_duros: bloqueadores,
    riesgos,
    senales_positivas: strengths.length >= 3 ? ["stack alineado con el perfil"] : [],
    veredicto: `DEMO: evaluación falsa por palabras clave, sin LLM (${strengths.length} coincidencias).`,
    accion_sugerida: accion,
  };
}

/** LlmClient de demo: valida contra el schema pedido (v1: gaps como strings; v1.1+: tipados). */
export function createDemoLlm(options: { calls?: CallSink } = {}): LlmClient {
  return {
    async generateStructured(task, schema, vars, ctx: GenerateContext = {}) {
      if (task !== "evaluate_job") {
        return err({
          kind: "no_route",
          task,
          detail: `modo demo: solo evaluate_job (pedido: ${task})`,
        });
      }
      const typed = demoEvaluation(vars);
      const legacy = {
        ...typed,
        gaps: (typed.gaps as { skill: string }[]).map((g) => g.skill),
      };
      const parsed = [typed, legacy].map((o) => schema.safeParse(o)).find((p) => p.success);
      if (!parsed?.success) {
        return err({
          kind: "generation_failed",
          task,
          detail: "modo demo: la salida no cumple el schema",
        });
      }
      const promptVersion = ctx.promptVersion ?? `${task}@v1`;
      await options.calls?.record({
        userId: ctx.userId ?? null,
        task: ctx.recordTask ?? task,
        model: DEMO_MODEL,
        promptVersion,
        jobId: ctx.jobId ?? null,
        tokensIn: 0,
        tokensOut: 0,
        tokensReasoning: 0,
        latencyMs: 0,
        costUsd: 0,
        label: ctx.label ?? "demo",
        ok: true,
        error: null,
      });
      return ok({
        object: parsed.data,
        model: DEMO_MODEL,
        provider: "fake",
        promptVersion,
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        costUsd: 0,
        latencyMs: 0,
        usedFallback: false,
      });
    },
  };
}
