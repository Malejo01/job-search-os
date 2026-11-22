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
    "%s: principal Claude Sonnet sin thinking, respaldo Gemini, temperatura 0 y max_tokens %i",
    (task, maxTokens) => {
      const rows = seed.filter((r) => r.task === task);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        fallback_model: "gemini-3.5-flash",
        thinking_level: null,
        temperature: 0,
        max_tokens: maxTokens,
        input_usd_per_mtok: 2,
        output_usd_per_mtok: 10,
        fallback_input_usd_per_mtok: 1.5,
        fallback_output_usd_per_mtok: 9,
      });
    },
  );
});
