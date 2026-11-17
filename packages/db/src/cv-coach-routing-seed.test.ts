import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ADR-038 §10: las dos tareas del coach de CV (R12-8 y R12-9). El nombre del modelo solo vive en el seed.
type Row = Record<string, unknown> & { task: string };
const seed = JSON.parse(
  readFileSync(new URL("../seeds/model_routing.json", import.meta.url), "utf8"),
) as Row[];

describe("model_routing: cv_review y cv_coach_turn", () => {
  it.each([
    ["cv_review", 2048],
    ["cv_coach_turn", 1536],
  ])(
    "%s: primario con thinking minimal, respaldo, temperatura 0, max_tokens %i y tarifas de cv_interview",
    (task, maxTokens) => {
      const rows = seed.filter((r) => r.task === task);
      expect(rows).toHaveLength(1);
      const interview = seed.find((r) => r.task === "cv_interview")!;
      expect(rows[0]).toMatchObject({
        provider: interview.provider,
        model: interview.model,
        fallback_model: interview.fallback_model,
        thinking_level: "minimal",
        temperature: 0,
        max_tokens: maxTokens,
        input_usd_per_mtok: interview.input_usd_per_mtok,
        output_usd_per_mtok: interview.output_usd_per_mtok,
        fallback_input_usd_per_mtok: interview.fallback_input_usd_per_mtok,
        fallback_output_usd_per_mtok: interview.fallback_output_usd_per_mtok,
      });
    },
  );
});
