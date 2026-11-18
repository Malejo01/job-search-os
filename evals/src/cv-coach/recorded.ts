import type { LlmClient } from "@job-search-os/adapters";

/**
 * Transcripciones grabadas (R12-13): lo que devolvió el modelo en cada llamada de una charla, en orden. Con
 * `replayLlm` la charla se vuelve a correr **sin modelo y sin gasto**: las métricas se recalculan sobre la
 * transcripción. Si el código cambió y pide otra tarea (o más llamadas) que las grabadas, falla cerrado:
 * la transcripción ya no corresponde y hay que grabarla de nuevo.
 *
 * Solo se graban fixtures públicas (inventadas). Una charla de una fixture privada no se graba al repo.
 */
export type RecordedCall = {
  task: string;
  object: unknown;
  costUsd: number | null;
  model: string;
};

export type RecordedTranscript = {
  fixtureId: string;
  /** `modelo`: grabada de una corrida real. `simulada`: armada a mano o con un modelo falso, para tests. */
  origen: "modelo" | "simulada";
  nota: string;
  calls: RecordedCall[];
};

/** Envuelve un cliente y guarda cada salida válida. */
export function recordingLlm(inner: LlmClient): { llm: LlmClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    llm: {
      async generateStructured(task, schema, vars, ctx) {
        const r = await inner.generateStructured(task, schema, vars, ctx);
        if (r.ok)
          calls.push({
            task,
            object: r.value.object,
            costUsd: r.value.costUsd,
            model: r.value.model,
          });
        return r;
      },
    },
  };
}

/** Devuelve las salidas grabadas en orden, validadas contra el esquema que pide cada llamada. */
export function replayLlm(t: RecordedTranscript): LlmClient & { remaining(): number } {
  let next = 0;
  return {
    remaining: () => t.calls.length - next,
    async generateStructured(task, schema, _vars, ctx = {}) {
      const call = t.calls[next];
      if (!call || call.task !== task) {
        return {
          ok: false,
          error: {
            kind: "generation_failed",
            task,
            detail: `transcripción ${t.fixtureId}: la llamada ${next + 1} no corresponde (grabar de nuevo)`,
          },
        };
      }
      next++;
      const parsed = schema.safeParse(call.object);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            kind: "generation_failed",
            task,
            detail: "transcripción: la salida no cumple el esquema",
          },
        };
      }
      return {
        ok: true,
        value: {
          object: parsed.data,
          model: call.model,
          provider: "grabada",
          promptVersion: ctx.promptVersion ?? `${task}@v1`,
          usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
          costUsd: call.costUsd,
          latencyMs: 0,
          usedFallback: false,
        },
      };
    },
  };
}
