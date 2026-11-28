import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// La ficha del aviso (R31-02, ADR-048): una tarea barata, con respaldo, sin thinking. El nombre del modelo solo vive acá.
type Row = Record<string, unknown> & { task: string };
const seed = JSON.parse(
  readFileSync(new URL("../seeds/model_routing.json", import.meta.url), "utf8"),
) as Row[];

describe("model_routing: extract_job_card", () => {
  it("una sola fila, Haiku 4.5 con respaldo Gemini Flash, temperatura 0 y tarifas del resto del seed", () => {
    expect(seed.filter((r) => r.task === "extract_job_card")).toHaveLength(1);
    expect(seed.find((r) => r.task === "extract_job_card")).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      fallback_model: "gemini-3.5-flash",
      temperature: 0,
      max_tokens: 3500,
      thinking_level: null,
      input_usd_per_mtok: 1,
      output_usd_per_mtok: 5,
      fallback_input_usd_per_mtok: 1.5,
      fallback_output_usd_per_mtok: 9,
    });
  });

  it("el prompt de la tarea existe en packages/prompts", () => {
    const md = readFileSync(
      new URL("../../prompts/extract_job_card.v1.md", import.meta.url),
      "utf8",
    );
    expect(md).toMatch(/^---\r?\nversion: extract_job_card@v1\r?\ntask: extract_job_card\r?\n/);
  });
});
