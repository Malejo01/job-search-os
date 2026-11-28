import { readFileSync } from "node:fs";
import { loadPrompt, renderPrompt } from "@job-search-os/prompts";
import {
  JOB_CARD_PROMPT,
  JOB_CARD_TEXT_MAX_CHARS,
  buildJobCardPromptVars,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { anthropicRequestFor } from "../cv-chat/fallback-request.util";
import { stepUsd, tokensOf } from "../cv-chat/estimate";
import { JOB_CARD_RESERVE_USD } from "./job-card-reserve";

/**
 * Calibración de la reserva de la ficha del aviso (misma idea que la de la evaluación): cubre el máximo de una
 * ficha con el ruteo del seed (primario agotando `max_tokens` y, si falla, el respaldo agotando el suyo, con el
 * aviso en su tope), sin exagerar. Sin red ni modelos.
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
const route = routes.find((r) => r.task === "extract_job_card")!;

describe("reserva de la ficha atada al seed", () => {
  it("cubre el máximo (primario + respaldo) y no pasa de 1,25 veces", async () => {
    const loaded = loadPrompt(JOB_CARD_PROMPT);
    if (!loaded.ok) throw new Error("sin prompt de la ficha");
    const { vars } = buildJobCardPromptVars("x".repeat(JOB_CARD_TEXT_MAX_CHARS * 2));
    const rendered = renderPrompt(loaded.value, vars);
    if (!rendered.ok) throw new Error("no renderiza");
    const inTokens = tokensOf(rendered.value.length);

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
    expect(JOB_CARD_RESERVE_USD).toBeGreaterThanOrEqual(max);
    expect(JOB_CARD_RESERVE_USD).toBeLessThanOrEqual(max * 1.25);
  });
});
