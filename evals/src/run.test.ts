import { createFakeLlm } from "@job-search-os/adapters";
import { describe, expect, it } from "vitest";
import {
  ANCHOR_IDS,
  BudgetExceededError,
  classifyError,
  DEFAULT_CALL_BUDGET,
  ESTIMATED_TOKENS_PER_CALL,
  estimateRunCost,
  MEASURED_TOKENS_PER_CALL,
  tokenSampleFor,
  FatalEvalError,
  parseThinkingFlag,
  priceForModel,
  routeFor,
  RunAbortedError,
  runEvals,
} from "./run";

/** Respuesta grabada válida para EvaluationV11OutputSchema (v1.1/v1.2). */
const evaluation = {
  score: 7,
  confianza: "baja",
  years_required: null,
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "ai_engineer",
  ingles_requerido: "no_menciona",
  tipo_empresa: "producto",
  paises_permitidos: null,
  match_fuerte: ["RAG"],
  gaps: [{ skill: "AWS", nivel: "deseable" }],
  bloqueadores_duros: [],
  riesgos: ["salario no publicado"],
  senales_positivas: [],
  veredicto: "ok",
  accion_sugerida: "aplicar",
};

const fake = () => createFakeLlm({ evaluate_job: evaluation });

describe("runEvals: subset y presupuesto", () => {
  it("--subset corre solo los 16 jobs ancla y marca el reporte", async () => {
    const client = fake();
    const report = await runEvals({
      prompt: "evaluate_job@v1.1",
      runs: 1,
      concurrency: 4,
      subset: true,
      outDir: "",
      client,
      sleep: async () => {},
    });
    expect(report.jobs.map((j) => j.id)).toEqual(ANCHOR_IDS);
    expect(report.meta.subset).toBe(true);
    expect(client.calls).toHaveLength(16);
    expect(report.metrics.anchor).toBe("human_score_match");
  });

  it("--subset con --ids intersecta", async () => {
    const report = await runEvals({
      prompt: "evaluate_job@v1.1",
      runs: 1,
      concurrency: 2,
      subset: true,
      ids: [32, 33, 99],
      outDir: "",
      client: fake(),
    });
    expect(report.jobs.map((j) => j.id)).toEqual([32, 33]);
  });

  it("aborta antes de la primera llamada si jobs × corridas supera el presupuesto", async () => {
    const client = fake();
    await expect(
      runEvals({ prompt: "evaluate_job@v1.1", runs: 5, concurrency: 2, outDir: "", client }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(client.calls).toHaveLength(0);
    expect(DEFAULT_CALL_BUDGET).toBe(150);
  });

  it("--force permite exceder el presupuesto; --budget lo ajusta", async () => {
    const forced = await runEvals({
      prompt: "evaluate_job@v1.1",
      runs: 1,
      concurrency: 8,
      budget: 10,
      force: true,
      outDir: "",
      client: fake(),
    });
    expect(forced.jobs).toHaveLength(36);
    await expect(
      runEvals({
        prompt: "evaluate_job@v1.1",
        runs: 1,
        concurrency: 8,
        budget: 10,
        outDir: "",
        client: fake(),
      }),
    ).rejects.toThrow(/presupuesto es 10/);
  });
});

describe("runEvals: guardarraíles de costo", () => {
  it("estima el costo antes de correr con la tarifa de model_routing y tokens medidos por modelo/thinking", () => {
    // seeds/model_routing.json: gemini-3.5-flash 1.5 in / 9 out por millón, thinking minimal
    const measured = MEASURED_TOKENS_PER_CALL["gemini-3.5-flash:minimal"]!;
    const e = estimateRunCost({ subset: true, runs: 1, model: "gemini-3.5-flash" });
    expect(e.calls).toBe(16);
    expect(e.tokensOutPerCall).toBe(measured.out);
    expect(e.source).toContain("medido");
    expect(e.usd).toBeCloseTo((16 * (measured.in * 1.5 + measured.out * 9)) / 1e6, 9);
    expect(estimateRunCost({ runs: 3 }).calls).toBe(108);
    // Sin medición para ese thinking: supuesto conservador (el caso caro), y lo dice
    const high = estimateRunCost({
      subset: true,
      runs: 1,
      model: "gemini-3.5-flash",
      thinking: "high",
    });
    expect(high.tokensOutPerCall).toBe(ESTIMATED_TOKENS_PER_CALL.out);
    expect(high.source).toContain("conservador");
    expect(tokenSampleFor("otro-modelo", "minimal").out).toBe(ESTIMATED_TOKENS_PER_CALL.out);
    // Historia de llm_calls: manda sobre la tabla medida
    const hist = estimateRunCost(
      { subset: true, runs: 1, model: "gemini-3.5-flash" },
      { in: 2000, out: 300, source: "historia" },
    );
    expect(hist.usd).toBeCloseTo((16 * (2000 * 1.5 + 300 * 9)) / 1e6, 9);
    // Modelo sin tarifa (override --model): no se puede estimar
    expect(estimateRunCost({ runs: 1, ids: [1], model: "otro-modelo" }).usd).toBeNull();
  });

  it("un error de schema aborta la corrida entera en vez de reintentar (cada reintento se factura)", async () => {
    const client = createFakeLlm(
      {},
      {
        failWith: {
          kind: "generation_failed",
          task: "evaluate_job",
          detail: "Error: salida no cumple el schema: [...]",
        },
      },
    );
    await expect(
      runEvals({
        prompt: "evaluate_job@v1.1",
        runs: 1,
        concurrency: 1,
        subset: true,
        outDir: "",
        client,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(FatalEvalError);
    expect(client.calls).toHaveLength(1);
  });

  it("una señal cancela la corrida: no arranca llamadas nuevas", async () => {
    const controller = new AbortController();
    const client = createFakeLlm({
      evaluate_job: () => {
        controller.abort(new Error("SIGINT"));
        return evaluation;
      },
    });
    await expect(
      runEvals({
        prompt: "evaluate_job@v1.1",
        runs: 1,
        concurrency: 1,
        subset: true,
        outDir: "",
        client,
        signal: controller.signal,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(RunAbortedError);
    expect(client.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("runEvals: modelo, thinking y registro", () => {
  it("routeFor toma la tarifa de cualquier fila del seed y el thinking del seed o del override", () => {
    // Primario: 3.5-flash con minimal (flash-lite falló ubicación exacta el 2026-09-11); sin fallback en evals
    const base = routeFor();
    expect(base).toMatchObject({
      model: "gemini-3.5-flash",
      thinkingLevel: "minimal",
      fallbackModel: null,
    });
    const lite = routeFor("gemini-3.1-flash-lite", "none");
    expect(lite).toMatchObject({
      provider: "google",
      inputUsdPerMtok: 0.25,
      outputUsdPerMtok: 1.5,
      thinkingLevel: "none",
    });
    expect(priceForModel("modelo-desconocido")).toEqual({ input: null, output: null });
    expect(() => parseThinkingFlag("alto")).toThrow(/--thinking inválido/);
    expect(parseThinkingFlag(undefined)).toBeUndefined();
  });

  it("el reporte lleva thinking, db y las llamadas van con task eval:<versión> y label", async () => {
    const client = fake();
    const report = await runEvals({
      prompt: "evaluate_job@v1.2",
      runs: 1,
      concurrency: 2,
      ids: [33],
      outDir: "",
      label: "paso4",
      client,
    });
    expect(report.meta).toMatchObject({ thinking: "minimal", db: "none", label: "paso4" });
    expect(client.calls[0]?.ctx).toMatchObject({ recordTask: "eval:v1.2", label: "paso4" });
  });
});

describe("classifyError: cuota por minuto vs. por día (nivel gratuito)", () => {
  it("la cuota por minuto se reintenta; la diaria, las credenciales y el schema abortan", () => {
    const perMinute =
      "AI_APICallError: You exceeded your current quota, please check your plan and billing details. quota_id: GenerateRequestsPerMinutePerProjectPerModel-FreeTier";
    const perDay =
      "AI_APICallError: You exceeded your current quota, please check your plan and billing details. quota_id: GenerateRequestsPerDayPerProjectPerModel-FreeTier";
    expect(classifyError(perMinute)).toBe("rate_limit");
    expect(classifyError(perDay)).toBe("fatal");
    expect(classifyError("Your prepayment credits are depleted.")).toBe("fatal");
    expect(classifyError("API key not valid. Please pass a valid API key.")).toBe("fatal");
    expect(classifyError("Error: salida no cumple el schema: [...]")).toBe("fatal");
    expect(classifyError("AI_APICallError: 503 Service Unavailable")).toBe("retry");
  });
});
