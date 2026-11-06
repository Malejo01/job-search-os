import { initialCvChatState, nextCvTopic } from "@job-search-os/pipeline";
import { expect, it } from "vitest";
import { createDemoLlm } from "../llm";
import { runCvInterviewTurn } from "./interview";
import { PERSONAS } from "./personas.fixtures";

// Regresión R4-16: los guiones completos de las personas no disparan repreguntas (y «no» es un rechazo).
it("las personas de prueba no reciben repreguntas con el fake", async () => {
  for (const p of PERSONAS) {
    const q = new Map(Object.entries(p.answers).map(([k, v]) => [k, [...(v ?? [])]]));
    let s = initialCvChatState();
    for (let i = 0; i < 40; i++) {
      const t = nextCvTopic(s);
      if (!t) break;
      const m = q.get(t.kind)?.shift() ?? "no";
      const o = await runCvInterviewTurn(
        { llm: createDemoLlm() },
        { userId: "u", conversationId: "0123456789ab", state: s, topic: t, message: m },
      );
      if (o.kind !== "turn") throw new Error("turno esperado");
      s = o.state;
    }
    expect(s.followUps, p.id).toEqual({});
  }
});
