import { createHash } from "node:crypto";
import {
  createLogger,
  loadCoachFallbacks,
  runCoachTurn,
  runCvReview,
  runCvWrite,
  type CoachTurnReserve,
  type LlmClient,
} from "@job-search-os/adapters";
import {
  CV_COACH_MAX_TURNS,
  startCoachChat,
  type CoachTurnSetup,
  type CvCoachAnswer,
  type CvCoachCard,
  type CvCoachState,
  type CvHistoryInput,
  type CvIssue,
  type CvWriteInput,
} from "@job-search-os/pipeline";
import {
  coachItems,
  reviewContext,
  skillNames,
  TAXONOMY,
  type CvCoachFixtureItem,
  type LoadedCvCoachFixture,
} from "./golden";
import type { CoachBudget, CoachEvalStage, CoachEvalStep } from "./guard";
import {
  conversationMetrics,
  issueAlreadyAddressed,
  type ConversationMetrics,
  type ConversationRecord,
  type QuestionLog,
} from "./metrics";
import { personaAnswer } from "./persona";

/**
 * Una charla del golden de punta a punta (R12-13, plan §5): diagnóstico (`runCvReview`) → charla guionada
 * (`runCoachTurn`, la persona es `persona.ts`) → redacción (`runCvWrite`, con el verificador de ADR-026).
 * Son los **mismos adaptadores que usa producción**; lo único que cambia es lo que en producción hace la
 * base: la reserva (acá la reemplaza el presupuesto de la corrida, `guard.ts`) y las tarjetas, que la
 * persona guionada acepta todas.
 *
 * El modelo entra como `LlmClient`: el real (lo corre Mauro), el de demo o una transcripción grabada
 * (`replayLlm`). Sin modelo real no hay gasto.
 */
export const EVAL_USER_ID = "00000000-0000-4000-8000-0000000e7a15";
/** La firma de la lista exige un secreto: en el harness no protege nada (no hay navegador). */
const EVAL_SIGNING_SECRET = "evals-cv-coach-sin-navegador";

const STEP_OF_TASK: Record<string, CoachEvalStep> = {
  cv_review: "review",
  cv_coach_turn: "turn",
  cv_write: "write",
};

/** `flowId` estable por fixture (12 hex, como el ticket del agente de perfil). */
export function evalFlowId(fixtureId: string): string {
  return createHash("sha256").update(`cv-coach:${fixtureId}`).digest("hex").slice(0, 12);
}

/**
 * Todas las llamadas del harness quedan en `llm_calls` con `task = eval:<versión del prompt>` y
 * `label = r12`, sin persona (no es gasto de nadie): así las suma el tope de la tanda.
 */
export function labeledLlm(inner: LlmClient, label: string): LlmClient {
  return {
    generateStructured(task, schema, vars, ctx = {}) {
      const { userId: _userId, ...rest } = ctx;
      return inner.generateStructured(task, schema, vars, {
        ...rest,
        label,
        recordTask: `eval:${ctx.promptVersion ?? task}`,
      });
    },
  };
}

/** Cuenta llamadas y costo por paso, y le avisa al presupuesto. */
function meteredLlm(
  inner: LlmClient,
  budget: CoachBudget,
  tally: { calls: number; costUsd: number },
): LlmClient {
  return {
    async generateStructured(task, schema, vars, ctx) {
      const r = await inner.generateStructured(task, schema, vars, ctx);
      const step = STEP_OF_TASK[task] ?? "turn";
      const cost = r.ok ? r.value.costUsd : null;
      budget.finished(step, cost);
      tally.calls++;
      tally.costUsd += cost ?? 0;
      return r;
    },
  };
}

/** En producción la reserva es contra `llm_calls`; acá la decide el presupuesto antes de llamar. */
const noReserve: CoachTurnReserve = {
  async reserve() {
    return { ok: true, reservationId: null };
  },
  async release() {},
};

type Item = CvCoachFixtureItem;

/** La persona acepta cada tarjeta, como si tocara «Aceptar» en todas. Devuelve los ítems nuevos. */
export function applyCards(items: readonly Item[], cards: readonly CvCoachCard[]): Item[] {
  const out = items.map((i) => ({ ...i, bullets: [...i.bullets] }));
  const byId = (id: string | null) => (id ? out.find((i) => i.id === id) : undefined);
  const push = (it: Item | undefined, line: string) => {
    if (it && !it.bullets.includes(line)) it.bullets.push(line);
  };
  for (const c of cards) {
    switch (c.kind) {
      case "bullets":
        for (const b of c.bullets) push(byId(c.historyId), b);
        break;
      case "dates": {
        const it = byId(c.historyId);
        if (it)
          Object.assign(it, {
            startMonth: c.startMonth,
            endMonth: c.endMonth,
            isCurrent: c.isCurrent,
          });
        break;
      }
      case "names": {
        const it = byId(c.historyId);
        if (it) {
          if (c.title !== null) it.title = c.title;
          if (c.organization !== null) it.organization = c.organization;
        }
        break;
      }
      case "link": {
        const it = byId(c.historyId);
        if (it) it.link = c.link;
        break;
      }
      case "stack":
        // Como el cierre: el stack va como viñeta «Stack: …» del ítem
        push(byId(c.historyId), `Stack: ${c.stack.join(", ")}`);
        break;
      case "new_item":
        out.push({
          clave: `nuevo-${out.length + 1}`,
          id: `00000000-0000-4000-8000-${(0xf00 + out.length).toString(16).padStart(12, "0")}`,
          kind: c.itemKind,
          organization: c.text,
          title: c.text,
          startMonth: null,
          endMonth: null,
          isCurrent: false,
          bullets: [],
          link: null,
        });
        break;
      case "note":
        // Una nota sin ítem no entra al CV hasta que la persona la ubique: la guionada no la ubica
        push(byId(c.historyId), c.text);
        break;
    }
  }
  return out;
}

const range = (i: Item): string =>
  i.startMonth ? `${i.startMonth} – ${i.isCurrent ? "actualidad" : (i.endMonth ?? "")}`.trim() : "";

/** Lo que va a `cv_write`: trabajos, estudios y cursos (los proyectos van al CV tal cual). */
export function writeInput(
  items: readonly Item[],
  target: string,
  skills: readonly string[],
): CvWriteInput {
  const history: CvHistoryInput[] = items
    .filter((i) => i.kind !== "proyecto")
    .map((i) => ({
      kind: i.kind as CvHistoryInput["kind"],
      organization: i.organization,
      title: i.title,
      startMonth: i.startMonth,
      endMonth: i.isCurrent ? null : i.endMonth,
      bullets: i.bullets,
    }));
  return { lang: "es", target, history, skills, languages: [] };
}

export type ConversationOutcome = {
  record: ConversationRecord;
  metrics: ConversationMetrics;
  /** Algo falló a mitad (sin texto: códigos). La charla igual se mide con lo que alcanzó. */
  errors: string[];
  /** Alguna llamada no se hizo por el tope de gasto. */
  cut: boolean;
};

export type RunConversationDeps = {
  llm: LlmClient;
  budget: CoachBudget;
  stage: CoachEvalStage;
  now?: () => Date;
  clock?: () => number;
};

export async function runConversation(
  loaded: LoadedCvCoachFixture,
  deps: RunConversationDeps,
): Promise<ConversationOutcome> {
  process.env.LOG_LEVEL ??= "silent";
  const f = loaded.fixture;
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? (() => Date.now());
  const started = clock();
  const tally = { calls: 0, costUsd: 0 };
  const llm = meteredLlm(deps.llm, deps.budget, tally);
  const flowId = evalFlowId(f.id);
  const errors: string[] = [];
  let items: Item[] = f.lectura.items.map((i) => ({ ...i, bullets: [...i.bullets] }));
  const skills = f.lectura.skills.map((s) => TAXONOMY.find((t) => t.slug === s)?.name ?? s);

  const record: ConversationRecord = {
    fixtureId: f.id,
    issues: [],
    questions: [],
    answers: [],
    finalCv: [],
    finalWritten: [],
    resolved: [],
    skipped: [],
    turns: 0,
    calls: 0,
    costUsd: 0,
    ms: 0,
    closeReason: null,
  };
  const finish = (): ConversationOutcome => {
    record.calls = tally.calls;
    record.costUsd = tally.costUsd;
    record.ms = clock() - started;
    return {
      record,
      metrics: conversationMetrics(record, f, TAXONOMY),
      errors,
      cut: deps.budget.cut(),
    };
  };

  // 1. Diagnóstico
  const keepWrite = deps.stage === "charla";
  if (!deps.budget.canStart("review", { keepWrite })) {
    record.closeReason = "tope_usd";
    record.finalCv = renderCv(items, null, skills);
    return finish();
  }
  const review = await runCvReview(
    { userId: EVAL_USER_ID, flowId, ctx: reviewContext(f) },
    {
      db: undefined as never,
      llm,
      logger: createLogger({ run_id: `evals-r12-${flowId}` }),
      now,
      env: { AUTH_SECRET: EVAL_SIGNING_SECRET },
      reserve: async () => ({
        ok: true,
        reservationId: "evals",
        measures: {
          turns: 0,
          reviews: 0,
          flowCostUsd: 0,
          written: false,
          userSpendTodayUsd: 0,
          dailySpendUsd: 0,
        },
      }),
      release: async () => true,
    },
  );
  if (!review.ok) {
    errors.push(`diagnostico:${review.error.code}`);
    record.finalCv = renderCv(items, null, skills);
    return finish();
  }
  const issues: CvIssue[] = review.value.signed.issues;
  record.issues = issues;
  if (deps.stage === "diagnostico") {
    record.closeReason = "solo_diagnostico";
    record.finalCv = renderCv(items, null, skills);
    return finish();
  }

  // 2. Charla guionada
  const fallbacks = loadCoachFallbacks();
  if (!fallbacks.ok) {
    errors.push("plantillas");
    record.finalCv = renderCv(items, null, skills);
    return finish();
  }
  const setup: CoachTurnSetup = {
    items: coachItems(items),
    skillNames: skillNames(),
    target: f.puesto_objetivo,
    issues,
    fallbacks: fallbacks.value,
  };
  const start = startCoachChat(setup);
  let state: CvCoachState = start.state;
  let question = start.question;
  const attempts = new Map<string, number>();

  while (state.stage !== "done" && question) {
    const issue = issues.find((i) => i.id === question!.issueId);
    if (!issue) {
      errors.push("charla:foco_desconocido");
      break;
    }
    const q: QuestionLog = {
      issueId: issue.id,
      type: issue.type,
      text: question.text,
      source: question.source,
      followUp: question.followUp,
      alreadyComplete: issueAlreadyAddressed(issue, items, TAXONOMY),
    };
    record.questions.push(q);
    const attempt = attempts.get(issue.id) ?? 0;
    attempts.set(issue.id, attempt + 1);
    let answer: CvCoachAnswer = personaAnswer(f, issue, attempt);

    if (answer.kind === "text") {
      if (record.turns >= CV_COACH_MAX_TURNS) {
        record.closeReason = "turnos";
        break;
      }
      if (!deps.budget.canStart("turn", { keepWrite: true })) {
        record.closeReason = "tope_usd";
        break;
      }
    }
    let outcome = await runCoachTurn(
      { llm, reserve: noReserve },
      {
        userId: EVAL_USER_ID,
        flowId,
        issues,
        target: f.puesto_objetivo,
        items: coachItems(items),
        skillNames: skillNames(),
        state,
        answer,
        now: now(),
      },
    );
    // Una respuesta que el producto rechaza antes del modelo (dato sensible, CV pegado): la persona dice
    // «no tengo», como haría con el aviso en pantalla
    if (
      outcome.kind === "rejected" &&
      ["sensitive", "pasted_cv", "injection", "too_long"].includes(outcome.reason)
    ) {
      errors.push(`turno_rechazado:${outcome.reason}`);
      answer = { kind: "none", issueId: issue.id };
      outcome = await runCoachTurn(
        { llm, reserve: noReserve },
        {
          userId: EVAL_USER_ID,
          flowId,
          issues,
          target: f.puesto_objetivo,
          items: coachItems(items),
          skillNames: skillNames(),
          state,
          answer,
          now: now(),
        },
      );
    }
    if (outcome.kind === "turn") {
      if (answer.kind === "text") record.answers.push(answer.text);
      if (outcome.usedModel) record.turns++;
      items = applyCards(items, outcome.result.cards);
      state = outcome.result.state;
      question = outcome.result.question;
      record.closeReason = outcome.result.closeReason;
      continue;
    }
    if (outcome.kind === "finished" || outcome.kind === "cap") {
      record.closeReason = outcome.kind === "cap" ? outcome.reject : "listo";
      break;
    }
    errors.push(
      outcome.kind === "rejected"
        ? `turno:${outcome.reason}`
        : outcome.kind === "error"
          ? `turno_llm:${outcome.error.kind}`
          : "turno:plantillas",
    );
    break;
  }
  record.resolved = [...state.resolved];
  record.skipped = [...state.skipped];

  // 3. Redacción (la reserva se apartó en cada turno: si se cortó por tope, igual alcanza)
  if (!deps.budget.canStart("write")) {
    errors.push("redaccion:tope_usd");
    record.finalCv = renderCv(items, null, skills);
    record.finalWritten = items.flatMap((i) => i.bullets);
    return finish();
  }
  const written = await runCvWrite(
    { llm },
    {
      userId: EVAL_USER_ID,
      conversationId: flowId,
      input: writeInput(items, f.puesto_objetivo, skills),
      knownTerms: TAXONOMY.map((t) => t.name),
    },
  );
  if (!written.ok) {
    errors.push(`redaccion_llm:${written.error.kind}`);
    record.finalCv = renderCv(items, null, skills);
    record.finalWritten = items.flatMap((i) => i.bullets);
    return finish();
  }
  // Las viñetas verificadas reemplazan a las de cada entrada (mismo orden que `writeInput`)
  const nonProjects = items.filter((i) => i.kind !== "proyecto");
  const finalItems = items.map((i) => {
    const n = nonProjects.indexOf(i);
    return n >= 0 && written.value.history[n]
      ? { ...i, bullets: [...written.value.history[n]!.bullets] }
      : i;
  });
  record.finalCv = renderCv(finalItems, written.value.summary, skills);
  record.finalWritten = [
    ...finalItems.flatMap((i) => i.bullets),
    ...(written.value.summary ? [written.value.summary] : []),
  ];
  return finish();
}

/** CV final como renglones: resumen, cada ítem con su título, organización, fechas, link y viñetas, skills. */
export function renderCv(
  items: readonly Item[],
  summary: string | null,
  skills: readonly string[],
): string[] {
  const lines: string[] = [];
  if (summary) lines.push(summary);
  for (const i of items) {
    lines.push([i.title, i.organization].filter(Boolean).join(", "));
    const r = range(i);
    if (r) lines.push(r);
    if (i.link) lines.push(i.link);
    lines.push(...i.bullets);
  }
  if (skills.length) lines.push(skills.join(", "));
  return lines;
}
