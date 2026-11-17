import { readFileSync } from "node:fs";
import { loadPrompt, renderPrompt } from "@job-search-os/prompts";
import {
  CV_BULLET_MAX_CHARS,
  CV_COACH_RESERVE_USD,
  CV_REVIEW_DEMAND_TOP,
  CV_REVIEW_MAX_CV_CHARS,
  CV_REVIEW_MAX_PERSON_SKILLS,
  cvReviewPromptVars,
  type CvReviewContext,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { stepUsd, tokensOf } from "../../cv-chat/estimate";
import { anthropicRequestFor } from "../../cv-chat/fallback-request.util";
import { CV_REVIEW_PROMPT } from "./run";

/**
 * Calibración de la reserva de `cv_review` (ADR-038 §9; patrón de `cv-chat/estimate.test.ts`): el máximo
 * del paso con las filas reales del seed, el peor prompt que acepta el código (CV confirmado al tope,
 * skills al tope, puesto y demanda largos) y el primario y el respaldo agotando `max_tokens`. La reserva
 * tiene que quedar entre 1 y 1,25 veces ese máximo.
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
  readFileSync(new URL("../../../../db/seeds/model_routing.json", import.meta.url), "utf8"),
) as Route[];

function worstContext(): CvReviewContext {
  const taxonomy = Array.from({ length: 60 }, (_, i) => ({
    slug: `skill-${i}-${"s".repeat(40)}`,
    name: "n".repeat(60),
    aliases: [],
  }));
  return {
    target: "p".repeat(200),
    // muchos más ítems de los que entran: el código corta en el tope de caracteres
    items: Array.from({ length: 40 }, (_, i) => ({
      id: `0b3f2c4e-1111-4222-8333-${String(i).padStart(12, "0")}`,
      kind: "trabajo" as const,
      organization: "o".repeat(120),
      title: "t".repeat(120),
      startMonth: "2020-01",
      endMonth: "2021-01",
      bullets: Array.from({ length: 6 }, () => "b".repeat(Math.min(250, CV_BULLET_MAX_CHARS))),
      link: null,
    })),
    personSkills: taxonomy.map((t) => t.slug),
    taxonomy,
    demand: taxonomy.slice(0, CV_REVIEW_DEMAND_TOP + 5).map((t) => ({
      slug: t.slug,
      mentions: 99,
      mustMentions: 99,
      weightedDemand: 99,
    })),
    summary: "r".repeat(3000),
  };
}

function maxReviewInputTokens(): number {
  const p = loadPrompt(CV_REVIEW_PROMPT);
  if (!p.ok) throw new Error("sin prompt");
  const vars = cvReviewPromptVars(worstContext());
  // el bloque del CV respeta el tope
  expect(vars.cv.length).toBeLessThanOrEqual(
    CV_REVIEW_MAX_CV_CHARS + "<<<CV>>>\n\n<<<FIN CV>>>".length,
  );
  expect(vars.person_skills.split("\n")).toHaveLength(CV_REVIEW_MAX_PERSON_SKILLS);
  const r = renderPrompt(p.value, vars);
  if (!r.ok) throw new Error("no renderiza");
  return tokensOf(r.value.length);
}

async function maxStepUsd(task: string, inTokens: number): Promise<number> {
  const r = routes.find((x) => x.task === task)!;
  const primary = stepUsd(inTokens, r.max_tokens, {
    inUsd: r.input_usd_per_mtok,
    outUsd: r.output_usd_per_mtok,
  });
  const sent = await anthropicRequestFor(r.fallback_model, r.max_tokens);
  const fallback = stepUsd(inTokens, sent.max_tokens ?? r.max_tokens, {
    inUsd: r.fallback_input_usd_per_mtok,
    outUsd: r.fallback_output_usd_per_mtok,
  });
  return primary + fallback;
}

describe("cv_review · reserva calibrada con el seed (máximo del paso, no el promedio)", () => {
  it("la reserva cubre el máximo (primario + respaldo) sin exagerar", async () => {
    const max = await maxStepUsd("cv_review", maxReviewInputTokens());
    expect(CV_COACH_RESERVE_USD.review).toBeGreaterThanOrEqual(max);
    expect(CV_COACH_RESERVE_USD.review).toBeLessThanOrEqual(max * 1.25);
  });
});
