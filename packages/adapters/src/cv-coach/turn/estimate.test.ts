import { readFileSync } from "node:fs";
import { loadPrompt, renderPrompt } from "@job-search-os/prompts";
import {
  CV_BULLET_MAX_CHARS,
  CV_CHAT_MAX_INPUT_CHARS,
  CV_COACH_RESERVE_USD,
  CV_MAX_BULLETS,
  CV_MAX_HISTORY_ENTRIES,
  HISTORY_FIELD_MAX_CHARS,
  type CvCoachItem,
  type CvIssue,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { tokensOf } from "../../cv-chat/estimate";
import { CV_COACH_TURN_PROMPT } from "./turn";
import { coachTurnVars } from "./vars";

type Route = {
  task: string;
  max_tokens: number;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  fallback_input_usd_per_mtok: number;
  fallback_output_usd_per_mtok: number;
};
const routes = JSON.parse(
  readFileSync(new URL("../../../../db/seeds/model_routing.json", import.meta.url), "utf8"),
) as Route[];

/** La fila `cv_coach_turn` del seed (la suma R12-8): el máximo sale de sus tarifas y su `max_tokens`. */
function coachRoute(): Route {
  const own = routes.find((r) => r.task === "cv_coach_turn");
  if (!own) throw new Error("falta la fila cv_coach_turn en el seed");
  return own;
}

/**
 * El CV más grande que acepta el historial: 20 ítems con empresa y cargo de 120 caracteres
 * (`HISTORY_FIELD_MAX_CHARS`), 6 viñetas de 220 y, en los proyectos, link de 200.
 */
function largestCv(): CvCoachItem[] {
  return Array.from({ length: CV_MAX_HISTORY_ENTRIES }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    section: i % 4 === 0 ? ("projects" as const) : ("experience" as const),
    organization: "x".repeat(HISTORY_FIELD_MAX_CHARS),
    title: "y".repeat(HISTORY_FIELD_MAX_CHARS),
    startMonth: "2020-01",
    endMonth: "2021-12",
    isCurrent: false,
    bullets: Array.from({ length: CV_MAX_BULLETS }, () => "z".repeat(CV_BULLET_MAX_CHARS)),
    link: i % 4 === 0 ? `https://ejemplo.com/${"p".repeat(180)}` : null,
  }));
}

const issue: CvIssue = {
  id: "iss:0",
  type: "logro_sin_resultado",
  ref: { section: "experience", itemId: "00000000-0000-4000-8000-000000000001", field: "bullets" },
  quote: null,
  skillSlug: null,
  severity: "alta",
  source: "model",
};

describe("reserva del paso `turn` contra el seed (ADR-038 §9)", () => {
  const route = coachRoute();
  const prompt = loadPrompt(CV_COACH_TURN_PROMPT);
  if (!prompt.ok) throw new Error(prompt.error.kind);
  const rendered = renderPrompt(
    prompt.value,
    coachTurnVars({
      ctx: { items: largestCv(), skillNames: {}, target: "t".repeat(120) },
      focus: issue,
      // el problema que sigue es de otro ítem: van las viñetas de los dos
      next: {
        ...issue,
        id: "iss:1",
        type: "tarea_vaga",
        ref: { ...issue.ref, itemId: "00000000-0000-4000-8000-000000000002" },
      },
      followUp: true,
      message: "m".repeat(CV_CHAT_MAX_INPUT_CHARS),
      today: "2026-11-17",
    }),
  );
  if (!rendered.ok) throw new Error("no renderiza");
  const inTok = tokensOf(rendered.value.length);
  // primario que agota la salida y falla, más el respaldo que también la agota
  const maxUsd =
    (inTok * route.input_usd_per_mtok + route.max_tokens * route.output_usd_per_mtok) / 1e6 +
    (inTok * route.fallback_input_usd_per_mtok +
      route.max_tokens * route.fallback_output_usd_per_mtok) /
      1e6;

  it("la reserva cubre el máximo de un turno y no lo pasa del 25 %", () => {
    expect(CV_COACH_RESERVE_USD.turn).toBeGreaterThanOrEqual(maxUsd);
    expect(CV_COACH_RESERVE_USD.turn).toBeLessThanOrEqual(maxUsd * 1.25);
  });

  it("el máximo usa un CV completo y el mensaje más largo (no el típico)", () => {
    // 20 encabezados, las viñetas de dos ítems, el mensaje de 2000 caracteres y el prompt
    expect(inTok).toBeGreaterThan(3_500);
    expect(rendered.value).toContain("m".repeat(CV_CHAT_MAX_INPUT_CHARS));
    console.info(`cv_coach_turn: ${inTok} tokens de entrada, máximo USD ${maxUsd.toFixed(4)}`);
  });
});
