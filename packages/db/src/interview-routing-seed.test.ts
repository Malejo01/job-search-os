import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// El simulador de entrevistas falla cerrado sin sus filas: tienen que estar en el seed, con tarifas del seed.
type Row = Record<string, string | number | null>;
const seed = JSON.parse(
  readFileSync(new URL("../seeds/model_routing.json", import.meta.url), "utf8"),
) as Row[];

describe("model_routing: simulador de entrevistas", () => {
  it("interview_questions va en el modelo chico, con respaldo y sin razonamiento extendido", () => {
    const rows = seed.filter((r) => r.task === "interview_questions");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      fallback_model: "gemini-3.5-flash",
      thinking_level: null,
      input_usd_per_mtok: 1,
      output_usd_per_mtok: 5,
      fallback_input_usd_per_mtok: 1.5,
      fallback_output_usd_per_mtok: 9,
    });
  });

  it("interview_feedback va en el modelo mediano, con respaldo y sin razonamiento extendido", () => {
    const rows = seed.filter((r) => r.task === "interview_feedback");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      fallback_model: "gemini-3.5-flash",
      thinking_level: null,
      input_usd_per_mtok: 2,
      output_usd_per_mtok: 10,
      fallback_input_usd_per_mtok: 1.5,
      fallback_output_usd_per_mtok: 9,
    });
  });

  it("las tarifas de las dos filas coinciden con las del resto del seed", () => {
    const price = new Map<string, [unknown, unknown]>();
    for (const r of seed.filter((x) => !String(x.task).startsWith("interview_"))) {
      for (const [model, i, o] of [
        [r.model, r.input_usd_per_mtok, r.output_usd_per_mtok],
        [r.fallback_model, r.fallback_input_usd_per_mtok, r.fallback_output_usd_per_mtok],
      ] as const) {
        if (model) price.set(String(model), [i, o]);
      }
    }
    for (const r of seed.filter((x) => String(x.task).startsWith("interview_"))) {
      expect(price.get(String(r.model))).toEqual([r.input_usd_per_mtok, r.output_usd_per_mtok]);
      expect(price.get(String(r.fallback_model))).toEqual([
        r.fallback_input_usd_per_mtok,
        r.fallback_output_usd_per_mtok,
      ]);
    }
  });
});
