import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// La carga de una oferta desde una imagen (R6-3) falla cerrado sin su fila: tiene que estar en el seed.
type Row = Record<string, string | number | null>;
const seed = JSON.parse(
  readFileSync(new URL("../seeds/model_routing.json", import.meta.url), "utf8"),
) as Row[];

describe("model_routing: extract_job_from_image", () => {
  it("existe una sola fila con los valores acordados", () => {
    const rows = seed.filter((r) => r.task === "extract_job_from_image");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      task: "extract_job_from_image",
      provider: "google",
      model: "gemini-3.5-flash",
      fallback_model: "claude-sonnet-5-5",
      temperature: 0,
      max_tokens: 4096,
      thinking_level: "minimal",
      input_usd_per_mtok: 1.5,
      output_usd_per_mtok: 9,
      fallback_input_usd_per_mtok: 2,
      fallback_output_usd_per_mtok: 10,
    });
  });
});
