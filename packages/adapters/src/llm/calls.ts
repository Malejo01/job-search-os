import { schema, type Db } from "@job-search-os/db";
import type { CallSink, LlmCallRecord } from "./types";

/** Persiste cada llamada en `llm_calls` (ARCHITECTURE §7). */
export function drizzleCallSink(db: Db): CallSink {
  return {
    async record(call) {
      await db.insert(schema.llmCalls).values({
        userId: call.userId,
        task: call.task,
        model: call.model,
        promptVersion: call.promptVersion,
        jobId: call.jobId,
        tokensIn: call.tokensIn,
        tokensOut: call.tokensOut,
        tokensReasoning: call.tokensReasoning,
        latencyMs: call.latencyMs,
        costUsd: call.costUsd,
        label: call.label,
        ok: call.ok,
        error: call.error,
      });
    },
  };
}

/** Sink en memoria (tests, evals sin DB). */
export function memoryCallSink(): CallSink & { calls: LlmCallRecord[] } {
  const calls: LlmCallRecord[] = [];
  return {
    calls,
    async record(call) {
      calls.push(call);
    },
  };
}
