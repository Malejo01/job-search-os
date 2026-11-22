import { readFileSync } from "node:fs";
import { loadPrompt, renderPrompt, templateVars } from "@job-search-os/prompts";
import { PROMPT_MAX_CHARS } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { anthropicRequestFor } from "../cv-chat/fallback-request.util";
import { stepUsd, tokensOf } from "../cv-chat/estimate";
import { DEFAULT_PROMPT_VERSIONS } from "./client";
import { EVALUATION_RESERVE_USD } from "./spend-reserve";

/**
 * Calibración de la reserva de la evaluación inmediata (misma idea que las del CV): cubre el máximo de
 * una evaluación con el ruteo del seed (primario agotando `max_tokens` y, si falla, el respaldo agotando
 * el suyo, con el prompt completo en su tope), sin exagerar. Sin red ni modelos.
 */
type Route = {
  task: string;
  max_tokens: number;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  fallback_model: string;
  fallback_input_usd_per_mtok: number;
  fallback_output_usd_per_mtok: number;
};
const routes = JSON.parse(
  readFileSync(new URL("../../../db/seeds/model_routing.json", import.meta.url), "utf8"),
) as Route[];
const route = routes.find((r) => r.task === "evaluate_job")!;

/** Prompt más grande que se manda: la plantilla más las variables de texto en su tope total. */
function maxPromptTokens(): number {
  const loaded = loadPrompt(DEFAULT_PROMPT_VERSIONS.evaluate_job!);
  if (!loaded.ok) throw new Error("sin prompt de evaluación");
  const names = templateVars(loaded.value.template);
  const vars: Record<string, string> = Object.fromEntries(names.map((n) => [n, ""]));
  vars[names[0]!] = "x".repeat(PROMPT_MAX_CHARS);
  const rendered = renderPrompt(loaded.value, vars);
  if (!rendered.ok) throw new Error("no renderiza");
  return tokensOf(rendered.value.length);
}

describe("reserva de la evaluación inmediata atada al seed", () => {
  it("cubre el máximo (primario + respaldo) y no pasa de 1,25 veces", async () => {
    const inTokens = maxPromptTokens();
    const primary = stepUsd(inTokens, route.max_tokens, {
      inUsd: route.input_usd_per_mtok,
      outUsd: route.output_usd_per_mtok,
    });
    const sent = await anthropicRequestFor(route.fallback_model, route.max_tokens);
    const fallback = stepUsd(inTokens, sent.max_tokens ?? route.max_tokens, {
      inUsd: route.fallback_input_usd_per_mtok,
      outUsd: route.fallback_output_usd_per_mtok,
    });
    const max = primary + fallback;
    expect(EVALUATION_RESERVE_USD).toBeGreaterThanOrEqual(max);
    expect(EVALUATION_RESERVE_USD).toBeLessThanOrEqual(max * 1.25);
  });
});
