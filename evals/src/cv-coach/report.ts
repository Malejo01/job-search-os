import type { CoachEvalStage } from "./guard";
import {
  aggregateMetrics,
  checkCvCoachThresholds,
  type AggregateMetrics,
  type ConversationMetrics,
  type ThresholdCheck,
} from "./metrics";
import type { ConversationOutcome } from "./run";

/**
 * Reporte de una corrida del coach (R12-13). **Solo métricas**: ni el texto del CV, ni las preguntas, ni las
 * respuestas, ni el CV final. Una fixture privada aparece como `privada-<n>`, sin su id.
 */
export type CoachEvalMode = "demo" | "simulada" | "grabada" | "modelo";

export type CoachReportRow = {
  fixture: string;
  source: "public" | "private";
  run: number;
  metrics: Omit<ConversationMetrics, "fixtureId">;
  /** Códigos, sin texto. */
  errors: string[];
};

export type CoachReport = {
  meta: {
    date: string;
    mode: CoachEvalMode;
    stage: CoachEvalStage;
    runs: number;
    maxUsd: number;
    cut: boolean;
    prompts: string[];
    /** El costo solo se mide con el modelo real. */
    measuresCost: boolean;
  };
  rows: CoachReportRow[];
  aggregate: AggregateMetrics;
  aggregatePublic: AggregateMetrics;
  thresholds: ThresholdCheck;
};

export function buildCoachReport(input: {
  mode: CoachEvalMode;
  stage: CoachEvalStage;
  runs: number;
  maxUsd: number;
  cut: boolean;
  outcomes: readonly { source: "public" | "private"; run: number; outcome: ConversationOutcome }[];
  date?: Date;
}): CoachReport {
  let privateN = 0;
  const privateNames = new Map<string, string>();
  const rows: CoachReportRow[] = input.outcomes.map(({ source, run, outcome }) => {
    const { fixtureId, ...metrics } = outcome.metrics;
    let fixture = fixtureId;
    if (source === "private") {
      if (!privateNames.has(fixtureId)) privateNames.set(fixtureId, `privada-${++privateN}`);
      fixture = privateNames.get(fixtureId)!;
    }
    return { fixture, source, run, metrics, errors: outcome.errors };
  });
  const all = input.outcomes.map((o) => o.outcome.metrics);
  const pub = input.outcomes.filter((o) => o.source === "public").map((o) => o.outcome.metrics);
  const measuresCost = input.mode === "modelo";
  const aggregate = aggregateMetrics(all);
  return {
    meta: {
      date: (input.date ?? new Date()).toISOString(),
      mode: input.mode,
      stage: input.stage,
      runs: input.runs,
      maxUsd: input.maxUsd,
      cut: input.cut,
      prompts: ["cv_review@v1", "cv_coach_turn@v1", "cv_coach_fallbacks@v1", "cv_write"],
      measuresCost,
    },
    rows,
    aggregate,
    aggregatePublic: aggregateMetrics(pub),
    thresholds: checkCvCoachThresholds(aggregate, { measuresCost, stage: input.stage }),
  };
}

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)} %`);
const num = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d));

export function formatCoachReport(r: CoachReport): string {
  const a = r.aggregate;
  const lines = [
    `Coach de CV · modo ${r.meta.mode} · etapa ${r.meta.stage} · ${r.rows.length} charla(s)${r.meta.cut ? " · CORTADO por tope de gasto: reporte parcial" : ""}`,
    "",
    "fixture                     inv  perdidos  repetidas  resueltos  recall  precisión  respaldo  turnos  USD",
    ...r.rows.map((row) => {
      const m = row.metrics;
      return [
        row.fixture.padEnd(26),
        String(m.inventions).padStart(4),
        `${m.lostFacts}/${m.facts}`.padStart(9),
        `${m.repeatedQuestions}/${m.questions}`.padStart(10),
        `${m.resolved}/${m.issues}`.padStart(10),
        num(m.diagnosisRecall).padStart(7),
        num(m.diagnosisPrecision).padStart(10),
        `${m.fallbackQuestions}/${m.questions}`.padStart(9),
        String(m.turns).padStart(7),
        m.costUsd.toFixed(3).padStart(6),
        row.errors.length ? `  [${row.errors.join(", ")}]` : "",
      ].join(" ");
    }),
    "",
    `invenciones ${a.inventions} · datos perdidos ${pct(a.lostRate)} · preguntas repetidas ${pct(a.repeatedRate)} · resueltos ${pct(a.resolvedRate)}`,
    `diagnóstico: recall ${num(a.diagnosisRecall)} · precisión ${num(a.diagnosisPrecision)} · preguntas de respaldo ${pct(a.fallbackRate)}`,
    `turnos (mediana) ${num(a.turnsMedian, 0)} · costo típico USD ${num(a.costMedianUsd, 3)} · total USD ${a.costTotalUsd.toFixed(3)}${r.meta.measuresCost ? "" : " (sin modelo real: el costo no se mide)"}`,
    "",
    r.thresholds.ok
      ? "Umbrales: pasan."
      : `Umbrales: NO pasan.\n${r.thresholds.failures.map((f) => `  - ${f}`).join("\n")}`,
    ...r.thresholds.warnings.map((w) => `  aviso: ${w}`),
    "",
  ];
  return lines.join("\n");
}
