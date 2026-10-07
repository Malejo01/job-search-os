import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeLlm, DEFAULT_PROMPT_VERSIONS, type LlmClient } from "@job-search-os/adapters";
import { ok, outputSchemaFor } from "@job-search-os/pipeline";
import { listPrompts } from "@job-search-os/prompts";
import { describe, expect, it } from "vitest";

describe("cobertura de versiones de evaluate_job", () => {
  // v1.3.3 se versionó sin registrar su schema y la corrida falló antes de llamar al modelo:
  // todo prompt evaluate_job del repo tiene que tener schema de salida.
  const versions = listPrompts().filter((ref) => ref.startsWith("evaluate_job@"));

  it("hay versiones para revisar", () => {
    expect(versions.length).toBeGreaterThan(0);
  });

  it.each(versions)("%s tiene schema de salida", (ref) => {
    expect(() => outputSchemaFor(ref)).not.toThrow();
  });
});
import { criteriaHash } from "./golden";
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
  resolvePromptFlag,
  routeFor,
  formatReport,
  RunAbortedError,
  runEvals,
  type Report,
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

describe("runEvals: tope de gasto durante la corrida (JS-080)", () => {
  /** Cliente falso que cobra `usd` por llamada (el FakeLlm de adapters siempre devuelve 0). */
  const charging = (usd: number | null): LlmClient & { calls: unknown[] } => {
    const inner = fake();
    return {
      calls: inner.calls,
      async generateStructured(task, schema, vars, ctx) {
        const r = await inner.generateStructured(task, schema, vars, ctx);
        return r.ok ? ok({ ...r.value, costUsd: usd }) : r;
      },
    };
  };
  const cutOptions = (client: LlmClient, concurrency: number, outDir: string) => ({
    prompt: "evaluate_job@v1.1" as const,
    runs: 1,
    concurrency,
    subset: true,
    outDir,
    client,
    sleep: async () => {},
    maxUsd: 0.05,
    expectedCallUsd: 0.01,
  });

  it.each([1, 3])(
    "con concurrencia %i corta tras N llamadas, nunca N+1, y deja el reporte marcado",
    async (concurrency) => {
      const dir = mkdtempSync(join(tmpdir(), "evals-cut-"));
      try {
        const client = charging(0.01);
        let error: unknown;
        await runEvals(cutOptions(client, concurrency, dir)).catch((e: unknown) => (error = e));
        expect(error).toBeInstanceOf(RunAbortedError);
        expect((error as RunAbortedError).message).toMatch(/tope de gasto/);
        expect(client.calls.length).toBeLessThanOrEqual(5);
        expect(client.calls.length).toBeGreaterThan(0);

        const [file] = readdirSync(dir);
        // Un reporte cortado no pisa a uno completo de la misma configuración
        expect(file).toMatch(/_cortado\.json$/);
        const report = JSON.parse(readFileSync(join(dir, file!), "utf8")) as Report;
        const cut = report.meta.cut_by_budget!;
        expect(cut.max_usd).toBe(0.05);
        expect(cut.calls_planned).toBe(16);
        expect(cut.calls_done).toBe(client.calls.length);
        expect(cut.spent_usd).toBeLessThanOrEqual(0.05 + 1e-9);
        expect(formatReport(report)).toMatch(/CORTADO por tope de gasto/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.each([1, 3])(
    "costo real mayor al esperado (concurrencia %i): corta y el exceso queda acotado a lo que estaba en vuelo",
    async (concurrency) => {
      // Esperado 0.01, real 0.04, tope 0.05. El tope en vuelo es aproximado a propósito: cada
      // llamada lanzada reservó solo 0.01, así que el exceso máximo sobre el tope es
      // concurrencia × (real − esperado); nunca crece con las llamadas que no se lanzaron.
      const dir = mkdtempSync(join(tmpdir(), "evals-cut-"));
      try {
        const client = charging(0.04);
        await expect(runEvals(cutOptions(client, concurrency, dir))).rejects.toBeInstanceOf(
          RunAbortedError,
        );
        const [file] = readdirSync(dir);
        const report = JSON.parse(readFileSync(join(dir, file!), "utf8")) as Report;
        const cut = report.meta.cut_by_budget!;
        expect(client.calls.length).toBeLessThan(16);
        expect(cut.spent_usd).toBeGreaterThan(0.05);
        expect(cut.spent_usd).toBeLessThanOrEqual(0.05 + concurrency * (0.04 - 0.01) + 1e-9);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("sin costo informado cuenta el esperado por llamada", async () => {
    const client = charging(null);
    await expect(runEvals(cutOptions(client, 1, ""))).rejects.toBeInstanceOf(RunAbortedError);
    expect(client.calls.length).toBe(5);
  });

  it("sin maxUsd no corta: la corrida completa termina igual que antes", async () => {
    const client = charging(0.01);
    const { maxUsd: _m, expectedCallUsd: _e, ...rest } = cutOptions(client, 3, "");
    const report = await runEvals(rest);
    expect(client.calls).toHaveLength(16);
    expect(report.meta.cut_by_budget).toBeUndefined();
  });

  it("un tope que alcanza para todo no corta", async () => {
    const client = charging(0.001);
    const report = await runEvals({ ...cutOptions(client, 2, ""), maxUsd: 1 });
    expect(client.calls).toHaveLength(16);
    expect(report.meta.cut_by_budget).toBeUndefined();
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

describe("--prompt vigente (JS-077) y hash de criterios (JS-067)", () => {
  it("'vigente' resuelve a la versión que usa producción; el default sigue en v1", () => {
    expect(resolvePromptFlag("vigente")).toBe(DEFAULT_PROMPT_VERSIONS.evaluate_job);
    expect(resolvePromptFlag("evaluate_job@v1.3.2")).toBe("evaluate_job@v1.3.2");
    expect(resolvePromptFlag(undefined)).toBe("evaluate_job@v1");
  });

  it("el reporte guarda el hash de criterios en meta", async () => {
    const report = await runEvals({
      prompt: "evaluate_job@v1.2",
      runs: 1,
      concurrency: 1,
      ids: [33],
      outDir: "",
      client: fake(),
    });
    expect(report.meta.criteria_hash).toBe(criteriaHash);
  });

  it("la tabla de tokens refleja lo medido en final-v132", () => {
    expect(MEASURED_TOKENS_PER_CALL["gemini-3.5-flash:minimal"]).toEqual({ in: 4_102, out: 418 });
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
