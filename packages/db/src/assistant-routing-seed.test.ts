import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// El asistente (R4-17) falla cerrado sin su fila: tiene que estar en el seed, con tarifas del seed.
type Row = Record<string, string | number | null>;
const seed = JSON.parse(
  readFileSync(new URL("../seeds/model_routing.json", import.meta.url), "utf8"),
) as Row[];

describe("model_routing: assistant_chat", () => {
  it("existe una sola fila con los valores acordados", () => {
    const rows = seed.filter((r) => r.task === "assistant_chat");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      task: "assistant_chat",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      fallback_model: "gemini-3.5-flash",
      temperature: 0.3,
      max_tokens: 600,
      thinking_level: null,
      input_usd_per_mtok: 2,
      output_usd_per_mtok: 10,
      fallback_input_usd_per_mtok: 1.5,
      fallback_output_usd_per_mtok: 9,
    });
  });

  it("la tarifa de cada modelo es igual en todas las filas", () => {
    const price = new Map<string, [unknown, unknown]>();
    for (const r of seed) {
      for (const [model, i, o] of [
        [r.model, r.input_usd_per_mtok, r.output_usd_per_mtok],
        [r.fallback_model, r.fallback_input_usd_per_mtok, r.fallback_output_usd_per_mtok],
      ] as const) {
        if (!model) continue;
        const seen = price.get(String(model));
        if (seen) expect([model, ...seen]).toEqual([model, i, o]);
        else price.set(String(model), [i, o]);
      }
    }
  });
});
