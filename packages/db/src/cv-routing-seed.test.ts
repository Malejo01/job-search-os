import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Las dos tareas del chat de CV (C-25) tienen que estar ruteadas, con las tarifas de cada modelo.
type Row = {
  task: string;
  temperature: number;
  provider: string;
  model: string;
  fallback_model: string | null;
  thinking_level: string | null;
  max_tokens: number;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  fallback_input_usd_per_mtok: number | null;
  fallback_output_usd_per_mtok: number | null;
};
const seed = JSON.parse(
  readFileSync(new URL("../seeds/model_routing.json", import.meta.url), "utf8"),
) as Row[];
const row = (task: string) => seed.find((r) => r.task === task);

describe("model_routing: cv_interview y cv_write", () => {
  it("primario Gemini Flash (los modelos de Anthropic fallan con no_object), thinking minimal", () => {
    for (const task of ["cv_interview", "cv_write"]) {
      expect(row(task), task).toMatchObject({
        provider: "google",
        model: "gemini-3.5-flash",
        thinking_level: "minimal",
        input_usd_per_mtok: 1.5,
        output_usd_per_mtok: 9,
      });
    }
  });

  it("respaldos: Haiku 4.5 para la entrevista y Sonnet 5.5 para la redacción, con sus tarifas", () => {
    expect(row("cv_interview")).toMatchObject({
      fallback_model: "claude-haiku-4-5",
      fallback_input_usd_per_mtok: 1,
      fallback_output_usd_per_mtok: 5,
    });
    expect(row("cv_write")).toMatchObject({
      fallback_model: "claude-sonnet-5-5",
      fallback_input_usd_per_mtok: 2,
      fallback_output_usd_per_mtok: 10,
    });
  });

  // ADR-034 §8: la lectura del CV del agente de perfil (R10-1). El nombre del modelo solo vive en el seed.
  it("extract_cv_profile: Gemini Flash con respaldo Haiku 4.5, temperatura 0 y 4096 tokens", () => {
    expect(seed.filter((r) => r.task === "extract_cv_profile")).toHaveLength(1);
    expect(row("extract_cv_profile")).toMatchObject({
      provider: "google",
      model: "gemini-3.5-flash",
      fallback_model: "claude-haiku-4-5",
      temperature: 0,
      max_tokens: 4096,
      thinking_level: "minimal",
      input_usd_per_mtok: 1.5,
      output_usd_per_mtok: 9,
      fallback_input_usd_per_mtok: 1,
      fallback_output_usd_per_mtok: 5,
    });
  });

  it("la tarifa de cada modelo es la misma que usan las demás filas", () => {
    const price = new Map<string, [number | null, number | null]>();
    for (const r of seed) {
      for (const [model, i, o] of [
        [r.model, r.input_usd_per_mtok, r.output_usd_per_mtok],
        [r.fallback_model, r.fallback_input_usd_per_mtok, r.fallback_output_usd_per_mtok],
      ] as const) {
        if (!model) continue;
        const seen = price.get(model);
        if (seen) expect([model, ...seen]).toEqual([model, i, o]);
        else price.set(model, [i, o]);
      }
    }
  });
});
