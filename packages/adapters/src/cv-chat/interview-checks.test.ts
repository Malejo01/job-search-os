import { CV_FIXED_ACK, initialCvChatState, nextCvTopic, ok } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import type { LlmClient } from "../llm";
import { runCvInterviewTurn } from "./interview";

/** Un modelo que devuelve lo que se le pide, sin validar: simula una salida hostil o equivocada. */
function modelReturning(object: unknown): LlmClient {
  return {
    async generateStructured() {
      return ok({
        object,
        model: "m",
        provider: "p",
        promptVersion: "cv_interview@v1",
        usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: null },
        costUsd: 0,
        latencyMs: 1,
        usedFallback: false,
      }) as never;
    },
  };
}

const base = { userId: "u1", conversationId: "0123456789ab" };
const s0 = initialCvChatState({ target: "Analista" });
const topic = nextCvTopic(s0)!; // organization

describe("controles sobre la salida del modelo (vuelta 2 de seguridad)", () => {
  it("S-4: un acuse con dígitos se reemplaza por el fijo", async () => {
    const out = await runCvInterviewTurn(
      {
        llm: modelReturning({
          extraction: { organization: "Empresa A", noExperience: false },
          ack: "Genial, 10 años",
        }),
      },
      { ...base, state: s0, topic, message: "Trabajé en Empresa A" },
    );
    expect(out).toMatchObject({ kind: "turn", ack: CV_FIXED_ACK });
  });

  it("S-5: una empresa que el mensaje no trae se descarta y el tema cuenta como falla", async () => {
    const out = await runCvInterviewTurn(
      {
        llm: modelReturning({
          extraction: { organization: "Empresa Z", noExperience: false },
          ack: null,
        }),
      },
      { ...base, state: s0, topic, message: "Trabajé en Empresa A" },
    );
    expect(out.kind).toBe("turn");
    if (out.kind !== "turn") return;
    expect(out.state.works).toHaveLength(0);
    expect(out.state.failures[topic.key]).toBe(1);
    expect(out.next?.kind).toBe("organization");
  });

  it("S-5: lo que sí dijo pasa", async () => {
    const out = await runCvInterviewTurn(
      {
        llm: modelReturning({
          extraction: { organization: "Empresa A", noExperience: false },
          ack: null,
        }),
      },
      { ...base, state: s0, topic, message: "Trabajé en Empresa A" },
    );
    if (out.kind !== "turn") throw new Error("turno esperado");
    expect(out.state.works[0]?.organization).toBe("Empresa A");
    expect(out.ack).toBeNull();
  });
});
