import {
  cvRejectReasons,
  foldCvText,
  type CvIssue,
  type CvRejectReason,
  type SkillTaxonomyEntry,
} from "@job-search-os/pipeline";
import type { CvCoachFixture, CvCoachFixtureItem, ExpectedIssue } from "./golden";

/**
 * Métricas de una charla del coach (R12-13, plan §5.2). Todas en código, sin juez LLM. Puras: reciben lo
 * que grabó la corrida (o una transcripción grabada) y no llaman a nada.
 */

/** Una pregunta que vio la persona. */
export type QuestionLog = {
  issueId: CvIssue["id"];
  type: CvIssue["type"];
  /** Texto de la pregunta (en reportes de fixtures privadas no se guarda). */
  text: string;
  source: "model" | "fallback";
  followUp: boolean;
  /** Al momento de preguntar, el dato ya estaba en el CV (ver `issueAlreadyAddressed`). */
  alreadyComplete: boolean;
};

/** Lo que dejó una charla: alcanza para calcular todas las métricas. */
export type ConversationRecord = {
  fixtureId: string;
  issues: CvIssue[];
  questions: QuestionLog[];
  /** Respuestas en texto que dio la persona (las de «no tengo» no cuentan). */
  answers: string[];
  /** CV final, renglón por renglón (títulos, fechas, viñetas y resumen). */
  finalCv: string[];
  /** Los renglones del CV final que redactó o tocó el modelo: viñetas y resumen. */
  finalWritten: string[];
  resolved: CvIssue["id"][];
  skipped: CvIssue["id"][];
  /** Turnos con respuesta de la persona (los que cuentan para el tope de 15). */
  turns: number;
  calls: number;
  costUsd: number;
  ms: number;
  closeReason: string | null;
};

const fold = (s: string): string => foldCvText(s).replace(/\s+/g, " ").trim();

/** Motivos del verificador que son invención (no formato). */
const INVENTION_REASONS: ReadonlySet<CvRejectReason> = new Set([
  "number_not_in_answers",
  "name_not_in_answers",
  "technology_not_in_answers",
  "link_or_email",
]);

/** Fuentes contra las que se mide el CV final: el CV, el puesto objetivo, lo que dijo la persona y sus skills. */
export function inventionSources(
  f: CvCoachFixture,
  answers: readonly string[],
  taxonomy: readonly SkillTaxonomyEntry[],
): string[] {
  const names = f.lectura.skills.map((s) => taxonomy.find((t) => t.slug === s)?.name ?? s);
  // El puesto objetivo también entra a `cv_write` (para el resumen): nombrarlo no es inventar
  return [f.cv_texto, f.puesto_objetivo, ...answers, ...names];
}

const STACK_LABEL_RE = /^stack:\s*/i;

/** Renglones del CV final que el verificador de ADR-026 marca como inventados. */
export function inventions(written: readonly string[], sources: readonly string[]): number {
  let n = 0;
  for (const line of written) {
    // «Stack: …» es el rótulo fijo con el que el cierre guarda el stack de un ítem: no es texto del modelo
    const text = line.replace(STACK_LABEL_RE, "");
    if (text.trim() === "") continue;
    const reasons = cvRejectReasons(text, sources, { maxChars: 10_000 });
    if (reasons.some((r) => INVENTION_REASONS.has(r))) n++;
  }
  return n;
}

/**
 * Datos perdidos: `hechos` que no aparecen en el CV final. Los de `fuente: respuesta` cuentan solo si la
 * persona llegó a decirlos (si la charla no preguntó por eso, no se pueden perder).
 */
export function lostFacts(
  f: CvCoachFixture,
  answers: readonly string[],
  finalCv: readonly string[],
): { lost: number; total: number; keys: string[] } {
  const said = fold(answers.join("\n"));
  const cv = fold(finalCv.join("\n"));
  const applicable = f.hechos.filter((h) => h.fuente === "cv" || said.includes(fold(h.valor)));
  const lost = applicable.filter((h) => !cv.includes(fold(h.valor)));
  return { lost: lost.length, total: applicable.length, keys: lost.map((h) => h.clave) };
}

function skillShown(
  slug: string,
  items: readonly CvCoachFixtureItem[],
  taxonomy: readonly SkillTaxonomyEntry[],
) {
  const entry = taxonomy.find((t) => t.slug === slug);
  if (!entry) return false;
  const terms = [entry.name, ...entry.aliases].map(fold).filter((t) => t.length > 1);
  const text = fold(
    items
      .filter((i) => i.kind === "trabajo" || i.kind === "proyecto")
      .flatMap((i) => [i.organization, i.title, ...i.bullets])
      .join("\n"),
  );
  return terms.some((t) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
      "u",
    ).test(text),
  );
}

/**
 * ¿El dato por el que pregunta el problema ya está en el CV (lo confirmado más las tarjetas aceptadas)?
 * Una pregunta así es «repetida»: pide algo ya completo o ya dicho en un turno anterior.
 */
export function issueAlreadyAddressed(
  issue: CvIssue,
  items: readonly CvCoachFixtureItem[],
  taxonomy: readonly SkillTaxonomyEntry[],
): boolean {
  const item = issue.ref.itemId ? items.find((i) => i.id === issue.ref.itemId) : undefined;
  switch (issue.type) {
    case "fecha_faltante":
      return !!item && item.startMonth !== null && (item.endMonth !== null || item.isCurrent);
    case "proyecto_sin_stack_o_link":
      return !!item && (item.link !== null || item.bullets.some((b) => /^stack:/i.test(b)));
    case "brecha_con_puesto":
    case "skill_pedida_sin_evidencia":
      return issue.skillSlug !== null && skillShown(issue.skillSlug, items, taxonomy);
    default:
      return false;
  }
}

/** Preguntas repetidas: ya completas al preguntar, o el mismo texto que una anterior sobre otro problema. */
export function repeatedQuestions(questions: readonly QuestionLog[]): number {
  let n = 0;
  const earlier: { issueId: string; text: string }[] = [];
  for (const q of questions) {
    const t = fold(q.text);
    const sameText = !q.followUp && earlier.some((e) => e.issueId !== q.issueId && e.text === t);
    if (q.alreadyComplete || sameText) n++;
    if (!q.followUp) earlier.push({ issueId: q.issueId, text: t });
  }
  return n;
}

/** ¿El problema detectado coincide con uno esperado? */
export function matchesExpected(issue: CvIssue, e: ExpectedIssue, f: CvCoachFixture): boolean {
  if (issue.type !== e.tipo) return false;
  if ("skill" in e) return issue.skillSlug === e.skill;
  if (e.item === null) return issue.ref.itemId === null;
  const id = f.lectura.items.find((i) => i.clave === e.item)?.id;
  return id !== undefined && issue.ref.itemId === id;
}

/** Recall y precisión del diagnóstico contra `problemas_esperados`. `null` si no hay con qué dividir. */
export function diagnosisScores(
  issues: readonly CvIssue[],
  f: CvCoachFixture,
): { recall: number | null; precision: number | null; hits: number } {
  const expected = f.problemas_esperados;
  const hitExpected = expected.filter((e) => issues.some((i) => matchesExpected(i, e, f))).length;
  const hitIssues = issues.filter((i) => expected.some((e) => matchesExpected(i, e, f))).length;
  return {
    recall: expected.length ? hitExpected / expected.length : null,
    precision: issues.length ? hitIssues / issues.length : null,
    hits: hitExpected,
  };
}

export type ConversationMetrics = {
  fixtureId: string;
  inventions: number;
  lostFacts: number;
  facts: number;
  /** Claves de los hechos perdidos (empresa, fecha…), nunca el valor. */
  lostKeys: string[];
  repeatedQuestions: number;
  questions: number;
  issues: number;
  resolved: number;
  diagnosisRecall: number | null;
  diagnosisPrecision: number | null;
  fallbackQuestions: number;
  turns: number;
  calls: number;
  costUsd: number;
  ms: number;
  closeReason: string | null;
};

export function conversationMetrics(
  rec: ConversationRecord,
  f: CvCoachFixture,
  taxonomy: readonly SkillTaxonomyEntry[],
): ConversationMetrics {
  const lost = lostFacts(f, rec.answers, rec.finalCv);
  const diag = diagnosisScores(rec.issues, f);
  return {
    fixtureId: rec.fixtureId,
    inventions: inventions(rec.finalWritten, inventionSources(f, rec.answers, taxonomy)),
    lostFacts: lost.lost,
    facts: lost.total,
    lostKeys: lost.keys,
    repeatedQuestions: repeatedQuestions(rec.questions),
    questions: rec.questions.length,
    issues: rec.issues.length,
    resolved: rec.resolved.length,
    diagnosisRecall: diag.recall,
    diagnosisPrecision: diag.precision,
    fallbackQuestions: rec.questions.filter((q) => q.source === "fallback").length,
    turns: rec.turns,
    calls: rec.calls,
    costUsd: rec.costUsd,
    ms: rec.ms,
    closeReason: rec.closeReason,
  };
}

export type AggregateMetrics = {
  conversations: number;
  /** Bloqueante: tiene que ser 0. */
  inventions: number;
  lostRate: number | null;
  repeatedRate: number | null;
  resolvedRate: number | null;
  diagnosisRecall: number | null;
  diagnosisPrecision: number | null;
  fallbackRate: number | null;
  turnsMedian: number | null;
  costMedianUsd: number | null;
  costTotalUsd: number;
  msMedian: number | null;
};

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const mean = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function aggregateMetrics(ms: readonly ConversationMetrics[]): AggregateMetrics {
  const sum = (k: keyof ConversationMetrics) => ms.reduce((a, m) => a + (m[k] as number), 0);
  return {
    conversations: ms.length,
    inventions: sum("inventions"),
    lostRate: ratio(sum("lostFacts"), sum("facts")),
    repeatedRate: ratio(sum("repeatedQuestions"), sum("questions")),
    resolvedRate: ratio(sum("resolved"), sum("issues")),
    diagnosisRecall: mean(ms.map((m) => m.diagnosisRecall)),
    diagnosisPrecision: mean(ms.map((m) => m.diagnosisPrecision)),
    fallbackRate: ratio(sum("fallbackQuestions"), sum("questions")),
    turnsMedian: median(ms.map((m) => m.turns)),
    costMedianUsd: median(ms.map((m) => m.costUsd)),
    costTotalUsd: sum("costUsd"),
    msMedian: median(ms.map((m) => m.ms)),
  };
}

/** Umbrales para pasar `CV_COACH` a `all` (plan §5.2). */
export const CV_COACH_THRESHOLDS = {
  inventions: 0,
  lostRateMax: 0.05,
  repeatedRateMax: 0.1,
  recallMin: 0.7,
  precisionMin: 0.6,
  costMedianMaxUsd: 0.2,
  /** Informativa: arriba de esto, revisar el prompt del turno. */
  fallbackRateWarn: 0.3,
} as const;

export type ThresholdCheck = { ok: boolean; failures: string[]; warnings: string[] };

/**
 * Compara contra los umbrales. Lo que no se pudo medir (`null`) no pasa: un reporte sin datos no habilita
 * nada. Con `measuresCost: false` (corridas con modelo de demo o grabadas) el costo no se evalúa.
 */
export function checkCvCoachThresholds(
  a: AggregateMetrics,
  opts: { measuresCost: boolean; stage?: "charla" | "diagnostico" },
): ThresholdCheck {
  const t = CV_COACH_THRESHOLDS;
  const failures: string[] = [];
  const warnings: string[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  if (opts.stage === "diagnostico") {
    if (a.diagnosisRecall === null || a.diagnosisRecall < t.recallMin)
      failures.push(
        `recall del diagnóstico: ${a.diagnosisRecall?.toFixed(2) ?? "sin medir"} (mín. ${t.recallMin})`,
      );
    if (a.diagnosisPrecision === null || a.diagnosisPrecision < t.precisionMin)
      failures.push(
        `precisión del diagnóstico: ${a.diagnosisPrecision?.toFixed(2) ?? "sin medir"} (mín. ${t.precisionMin})`,
      );
    return { ok: failures.length === 0, failures, warnings };
  }
  if (a.inventions > t.inventions)
    failures.push(`invenciones: ${a.inventions} (tiene que ser 0, bloqueante)`);
  if (a.lostRate === null || a.lostRate > t.lostRateMax)
    failures.push(
      `datos perdidos: ${a.lostRate === null ? "sin medir" : pct(a.lostRate)} (máx. ${pct(t.lostRateMax)})`,
    );
  if (a.repeatedRate === null || a.repeatedRate > t.repeatedRateMax)
    failures.push(
      `preguntas repetidas: ${a.repeatedRate === null ? "sin medir" : pct(a.repeatedRate)} (máx. ${pct(t.repeatedRateMax)})`,
    );
  if (a.diagnosisRecall === null || a.diagnosisRecall < t.recallMin)
    failures.push(
      `recall del diagnóstico: ${a.diagnosisRecall?.toFixed(2) ?? "sin medir"} (mín. ${t.recallMin})`,
    );
  if (a.diagnosisPrecision === null || a.diagnosisPrecision < t.precisionMin)
    failures.push(
      `precisión del diagnóstico: ${a.diagnosisPrecision?.toFixed(2) ?? "sin medir"} (mín. ${t.precisionMin})`,
    );
  if (opts.measuresCost && (a.costMedianUsd === null || a.costMedianUsd > t.costMedianMaxUsd))
    failures.push(
      `costo típico: USD ${a.costMedianUsd?.toFixed(3) ?? "sin medir"} (máx. ${t.costMedianMaxUsd})`,
    );
  if (a.fallbackRate !== null && a.fallbackRate > t.fallbackRateWarn)
    warnings.push(
      `preguntas de respaldo: ${pct(a.fallbackRate)} (más de ${pct(t.fallbackRateWarn)}: revisar el prompt)`,
    );
  return { ok: failures.length === 0, failures, warnings };
}
