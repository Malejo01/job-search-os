import { err, ok } from "@job-search-os/pipeline";
import type { GenerateContext, GenerateFn, LlmClient, LlmError } from "./types";

type Vars = Record<string, string | number | boolean>;
type Responder = unknown | ((vars: Vars, ctx: GenerateContext) => unknown);

export type FakeCall = { task: string; vars: Vars; ctx: GenerateContext };

/** Proveedor colgado: solo termina cuando lo abortan. Para probar timeouts y SIGINT/SIGTERM sin red. */
export const hangingGenerate: GenerateFn = (args) =>
  new Promise((_, reject) => {
    args.abortSignal?.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
  });

/** Hook de prueba de los CLIs: LLM_FAKE_GENERATE=hang reemplaza generateObject por hangingGenerate. */
export function generateFromEnv(env: NodeJS.ProcessEnv = process.env): GenerateFn | undefined {
  if (env.LLM_FAKE_GENERATE === "hang") return hangingGenerate;
  if (env.LLM_FAKE_GENERATE)
    throw new Error(`LLM_FAKE_GENERATE desconocido: '${env.LLM_FAKE_GENERATE}'`);
  return undefined;
}

/**
 * FakeLlm: respuestas grabadas por tarea, sin red (TESTING_STRATEGY regla 3).
 * Valida la respuesta contra el schema igual que el cliente real.
 */
export function createFakeLlm(
  responses: Record<string, Responder>,
  options: { model?: string; failWith?: LlmError } = {},
): LlmClient & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const model = options.model ?? "fake-model";
  return {
    calls,
    async generateStructured(task, schema, vars, ctx = {}) {
      calls.push({ task, vars, ctx });
      if (ctx.signal?.aborted) {
        return err({ kind: "aborted", task, detail: "cancelada antes de llamar" });
      }
      if (options.failWith) return err(options.failWith);
      if (!(task in responses)) {
        return err({ kind: "no_route", task, detail: `FakeLlm sin respuesta para '${task}'` });
      }
      const responder = responses[task];
      const raw = typeof responder === "function" ? responder(vars, ctx) : responder;
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return err({ kind: "generation_failed", task, detail: parsed.error.message });
      }
      return ok({
        object: parsed.data,
        model,
        provider: "fake",
        promptVersion: ctx.promptVersion ?? `${task}@v1`,
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        costUsd: 0,
        latencyMs: 0,
        usedFallback: false,
      });
    },
  };
}
