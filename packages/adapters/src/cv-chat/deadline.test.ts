import { initialCvChatState, nextCvTopic } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import {
  createLlmClient,
  memoryCallSink,
  staticRouteSource,
  type GenerateFn,
  type RouteConfig,
} from "../llm";
import { CV_CHAT_DEADLINE_MS } from "./ids";
import { runCvInterviewTurn } from "./interview";
import { CV_RESERVE_TTL_MS } from "./reserve";
import { runCvWrite } from "./write";

/**
 * El deadline de 50 s es por PASO (primario y respaldo juntos), no por intento, y es bastante menor que
 * la vida de la reserva (2 minutos): mientras el paso corre, su reserva sigue contando.
 */
const route = (task: string): RouteConfig => ({
  task,
  provider: "google",
  model: "modelo-primario",
  fallbackModel: "claude-haiku-4-5",
  temperature: 0,
  maxTokens: 512,
  thinkingLevel: null,
  inputUsdPerMtok: 1,
  outputUsdPerMtok: 1,
  fallbackInputUsdPerMtok: 1,
  fallbackOutputUsdPerMtok: 1,
});

/** Un proveedor colgado: no responde hasta que le cancelan la llamada. */
function hanging(): { generate: GenerateFn; calls: () => number } {
  let calls = 0;
  const generate: GenerateFn = (args) => {
    calls++;
    return new Promise((_resolve, reject) => {
      args.abortSignal?.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  };
  return { generate, calls: () => calls };
}

function clientWith(generate: GenerateFn) {
  return createLlmClient({
    routes: staticRouteSource([route("cv_interview"), route("cv_write")]),
    calls: memoryCallSink(),
    providers: { modelFor: () => ({}) as never },
    generate,
  });
}

describe("deadline por paso", () => {
  it("el deadline deja al menos el doble de margen frente a la vida de la reserva", () => {
    expect(CV_CHAT_DEADLINE_MS).toBe(50_000);
    expect(CV_CHAT_DEADLINE_MS * 2).toBeLessThanOrEqual(CV_RESERVE_TTL_MS);
  });

  it("entrevista: con el primario colgado, el paso termina al deadline y no prueba el respaldo", async () => {
    const h = hanging();
    const s0 = initialCvChatState({ target: "Analista" });
    const t0 = Date.now();
    const out = await runCvInterviewTurn(
      { llm: clientWith(h.generate) },
      {
        userId: "u",
        conversationId: "0123456789ab",
        state: s0,
        topic: nextCvTopic(s0)!,
        message: "Trabajé en Empresa A",
        deadlineMs: 150,
      },
    );
    expect(out.kind).toBe("error");
    expect(Date.now() - t0).toBeLessThan(2_000);
    // Un solo intento: pasado el deadline no hay segundo intento con otro modelo
    expect(h.calls()).toBe(1);
  });

  it("redacción: lo mismo", async () => {
    const h = hanging();
    const t0 = Date.now();
    const out = await runCvWrite(
      { llm: clientWith(h.generate) },
      {
        userId: "u",
        conversationId: "0123456789ab",
        input: {
          lang: "es",
          target: "Analista",
          history: [
            {
              kind: "trabajo",
              organization: "Empresa A",
              title: "Analista",
              startMonth: null,
              endMonth: null,
              bullets: ["Armé reportes"],
            },
          ],
          skills: [],
          languages: [],
        },
        deadlineMs: 150,
      },
    );
    expect(out.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(h.calls()).toBe(1);
  });
});
