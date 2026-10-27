import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * Qué pedido arma el SDK de Anthropic para un modelo de respaldo con `reasoning: minimal`, con un fetch falso
 * (sin red). Sirve para comprobar que no manda `thinking: disabled` ni un presupuesto inválido, y para saber
 * el `max_tokens` real que se factura como tope de salida.
 */
export type AnthropicBody = {
  max_tokens?: number;
  thinking?: { type: string; budget_tokens?: number };
  output_config?: { effort?: string };
};

export async function anthropicRequestFor(
  model: string,
  maxOutputTokens: number,
): Promise<AnthropicBody> {
  let body: AnthropicBody = {};
  const provider = createAnthropic({
    apiKey: "clave-falsa",
    fetch: (async (_url: unknown, init?: { body?: unknown }) => {
      body = JSON.parse(String(init?.body)) as AnthropicBody;
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model,
          content: [{ type: "text", text: '{"ok":true}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });
  await generateObject({
    model: provider(model),
    schema: z.object({ ok: z.boolean() }),
    prompt: "x",
    maxOutputTokens,
    reasoning: "minimal",
    maxRetries: 0,
  }).catch(() => undefined); // solo importa el pedido
  return body;
}
