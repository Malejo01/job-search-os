/**
 * Feedback loop (JS-036, PRD §1.5): el resultado real de cada postulación contra el score del
 * evaluador. Puro: recibe filas (una por oferta con su última evaluación y su postulación si
 * existe) y devuelve el reporte. Lo que se calibra acá son ofertas reales, no el golden.
 */
export const APPLICATION_OUTCOMES = [
  "sin_respuesta",
  "rechazo_automatico_ubicacion",
  "rechazo_automatico_otro",
  "rechazo_humano",
  "entrevista",
  "oferta",
  "cerrada_antes",
  "retirada",
] as const;
export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

export const POSITIVE_OUTCOMES: readonly ApplicationOutcome[] = ["entrevista", "oferta"];

export type FeedbackRow = {
  jobId: string;
  /** Score final de la última evaluación (null si no hay). */
  score: number | null;
  /** Score humano cargado en la UI sobre esa evaluación. */
  humanScore: number | null;
  accion: string | null;
  model: string | null;
  locationOk: string | null;
  /** null = no hubo postulación. */
  outcome: ApplicationOutcome | null;
};

export const SCORE_BANDS = ["9+", "7–8,9", "5–6,9", "<5", "sin score"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export function scoreBand(score: number | null): ScoreBand {
  if (score === null) return "sin score";
  if (score >= 9) return "9+";
  if (score >= 7) return "7–8,9";
  if (score >= 5) return "5–6,9";
  return "<5";
}

export type BandStats = {
  band: ScoreBand;
  /** Ofertas evaluadas en la banda (postuladas o no). */
  evaluated: number;
  applied: number;
  positive: number;
  rejectedHuman: number;
  rejectedAuto: number;
  noAnswer: number;
  /** positive / applied, null sin postulaciones. */
  positiveRate: number | null;
};

export type FeedbackReport = {
  evaluated: number;
  applied: number;
  bands: BandStats[];
  /** Métrica del PRD: tasa de respuesta positiva a postulaciones con score ≥ 7. */
  highScore: { applied: number; positive: number; rate: number | null };
  surprises: {
    /** Score < 5 y entrevista u oferta: el evaluador subestimó. */
    lowScorePositive: FeedbackRow[];
    /** Rechazo automático por ubicación con location_ok = ok: el aviso o la regla mienten. */
    autoLocationRejectWithOk: FeedbackRow[];
    /** Score ≥ 7 sin respuesta después de postular. */
    highScoreNoAnswer: FeedbackRow[];
  };
  /** Modelo vs score humano de la UI (excluye evaluaciones humanas): null sin pares. */
  humanVsModel: { n: number; mae: number; bias: number } | null;
};

const isPositive = (o: ApplicationOutcome | null) => o !== null && POSITIVE_OUTCOMES.includes(o);
const isAutoReject = (o: ApplicationOutcome | null) =>
  o === "rechazo_automatico_ubicacion" || o === "rechazo_automatico_otro";

export function buildFeedbackReport(rows: readonly FeedbackRow[]): FeedbackReport {
  const applied = rows.filter((r) => r.outcome !== null);
  const bands: BandStats[] = SCORE_BANDS.map((band) => {
    const inBand = rows.filter((r) => scoreBand(r.score) === band);
    const app = inBand.filter((r) => r.outcome !== null);
    const positive = app.filter((r) => isPositive(r.outcome)).length;
    return {
      band,
      evaluated: inBand.length,
      applied: app.length,
      positive,
      rejectedHuman: app.filter((r) => r.outcome === "rechazo_humano").length,
      rejectedAuto: app.filter((r) => isAutoReject(r.outcome)).length,
      noAnswer: app.filter((r) => r.outcome === "sin_respuesta").length,
      positiveRate: app.length ? positive / app.length : null,
    };
  });
  const high = applied.filter((r) => r.score !== null && r.score >= 7);
  const highPositive = high.filter((r) => isPositive(r.outcome)).length;

  const pairs = rows.filter(
    (r) => r.score !== null && r.humanScore !== null && r.model !== "human",
  );
  const humanVsModel = pairs.length
    ? {
        n: pairs.length,
        mae: pairs.reduce((a, r) => a + Math.abs(r.score! - r.humanScore!), 0) / pairs.length,
        bias: pairs.reduce((a, r) => a + (r.score! - r.humanScore!), 0) / pairs.length,
      }
    : null;

  return {
    evaluated: rows.length,
    applied: applied.length,
    bands,
    highScore: {
      applied: high.length,
      positive: highPositive,
      rate: high.length ? highPositive / high.length : null,
    },
    surprises: {
      lowScorePositive: applied.filter(
        (r) => r.score !== null && r.score < 5 && isPositive(r.outcome),
      ),
      autoLocationRejectWithOk: applied.filter(
        (r) => r.outcome === "rechazo_automatico_ubicacion" && r.locationOk === "ok",
      ),
      highScoreNoAnswer: high.filter((r) => r.outcome === "sin_respuesta"),
    },
    humanVsModel,
  };
}
