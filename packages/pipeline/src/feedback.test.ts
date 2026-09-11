import { describe, expect, it } from "vitest";
import { buildFeedbackReport, scoreBand, type FeedbackRow } from "./feedback";

const row = (p: Partial<FeedbackRow>): FeedbackRow => ({
  jobId: p.jobId ?? "j",
  score: p.score ?? null,
  humanScore: p.humanScore ?? null,
  accion: p.accion ?? null,
  model: p.model ?? "gemini-3.1-flash-lite",
  locationOk: p.locationOk ?? "ok",
  outcome: p.outcome ?? null,
});

describe("scoreBand", () => {
  it("agrupa por las bandas del prompt", () => {
    expect(scoreBand(9)).toBe("9+");
    expect(scoreBand(7)).toBe("7–8,9");
    expect(scoreBand(6.5)).toBe("5–6,9");
    expect(scoreBand(4.5)).toBe("<5");
    expect(scoreBand(null)).toBe("sin score");
  });
});

describe("buildFeedbackReport (JS-036)", () => {
  const rows: FeedbackRow[] = [
    row({ jobId: "a", score: 9, outcome: "entrevista" }),
    row({ jobId: "b", score: 8, outcome: "rechazo_humano" }),
    row({ jobId: "c", score: 7.5, outcome: "sin_respuesta" }),
    row({ jobId: "d", score: 7, outcome: "rechazo_automatico_ubicacion", locationOk: "ok" }),
    row({ jobId: "e", score: 6, outcome: "oferta" }),
    row({ jobId: "f", score: 4, outcome: "entrevista" }),
    row({ jobId: "g", score: 8, outcome: null }), // evaluada, no postulada
  ];

  it("cuenta postulaciones y respuestas positivas por banda de score", () => {
    const r = buildFeedbackReport(rows);
    const high = r.bands.find((b) => b.band === "7–8,9")!;
    expect(high).toMatchObject({
      evaluated: 4,
      applied: 3,
      positive: 0,
      rejectedHuman: 1,
      rejectedAuto: 1,
      noAnswer: 1,
    });
    expect(r.bands.find((b) => b.band === "9+")).toMatchObject({
      applied: 1,
      positive: 1,
      positiveRate: 1,
    });
    expect(r.bands.find((b) => b.band === "<5")).toMatchObject({ applied: 1, positive: 1 });
    expect(r.evaluated).toBe(7);
    expect(r.applied).toBe(6);
  });

  it("la métrica del PRD: tasa de respuesta positiva con score ≥ 7", () => {
    const r = buildFeedbackReport(rows);
    // a, b, c, d postuladas con score ≥ 7; solo a tuvo entrevista
    expect(r.highScore).toEqual({ applied: 4, positive: 1, rate: 0.25 });
  });

  it("señala sorpresas: score bajo con respuesta positiva, rechazo por ubicación con location_ok = ok, alto sin respuesta", () => {
    const r = buildFeedbackReport(rows);
    expect(r.surprises.lowScorePositive.map((s) => s.jobId)).toEqual(["f"]);
    expect(r.surprises.autoLocationRejectWithOk.map((s) => s.jobId)).toEqual(["d"]);
    expect(r.surprises.highScoreNoAnswer.map((s) => s.jobId)).toEqual(["c"]);
  });

  it("compara score del modelo contra el score humano cargado en la UI (no el golden)", () => {
    const r = buildFeedbackReport([
      row({ score: 8, humanScore: 7 }),
      row({ score: 6, humanScore: 7 }),
      row({ score: 5, humanScore: 5, model: "human" }), // referencia humana: no se compara consigo misma
      row({ score: 9, humanScore: null }),
    ]);
    expect(r.humanVsModel).toEqual({ n: 2, mae: 1, bias: 0 });
  });

  it("sin postulaciones devuelve tasas nulas, no NaN", () => {
    const r = buildFeedbackReport([row({ score: 8 })]);
    expect(r.applied).toBe(0);
    expect(r.highScore.rate).toBeNull();
    expect(r.bands.every((b) => b.positiveRate === null)).toBe(true);
    expect(r.humanVsModel).toBeNull();
  });
});
