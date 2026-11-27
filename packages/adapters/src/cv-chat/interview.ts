/**
 * Un turno de la entrevista de CV (C-25, tarea `cv_interview`). Una llamada estructurada por turno (sin
 * streaming): el modelo extrae la respuesta al esquema del tema que decidió el código y suma un acuse corto.
 * La pregunta siguiente sale de una plantilla fija según el checklist: ninguna salida del modelo decide el
 * temario ni dispara una acción. El respaldo de proveedor lo hace el cliente antes de devolver nada.
 */
import {
  applyCvAnswer,
  applyCvModelTurn,
  classifyCvChatInput,
  CV_FIXED_ACK,
  cvLocalAnswer,
  isCvLocalTopic,
  resolveCvConflict,
  cvChatCloseReason,
  cvInterviewTurnSchema,
  cvTopicQuestion,
  nextCvTopic,
  skipCvTopic,
  type CvChatState,
  type CvCloseReason,
  type CvTopic,
} from "@job-search-os/pipeline";
import type { LlmClient, LlmError } from "../llm";
import { cvChatLabel, cvChatSignal } from "./ids";

export const CV_INTERVIEW_TASK = "cv_interview";
/** Versión vigente del prompt de la entrevista (R12-2: `extras`). El modelo sale de `model_routing`. */
export const CV_INTERVIEW_PROMPT = "cv_interview@v3";
const SKIP_RE = /^\s*(saltear|saltearlo|paso|skip|no s[eé]|no se)\s*[.!]*\s*$/i;

export type CvInterviewParams = {
  userId: string;
  conversationId: string;
  state: CvChatState;
  topic: CvTopic;
  message: string;
  signal?: AbortSignal;
  /** Solo para tests: el deadline del paso (primario y respaldo juntos). Por defecto 50 s. */
  deadlineMs?: number;
};

export type CvInterviewOutcome =
  /** La persona pegó un CV entero: se la deriva a la lectura de CV (ADR-008) y no se llama al modelo. */
  | { kind: "redirect_cv_reader" }
  | { kind: "rejected"; reason: "empty" | "too_long" | "injection" }
  /** El proveedor y su respaldo fallaron: el estado no cambia y no cuenta como turno. */
  | { kind: "error"; error: LlmError }
  | {
      kind: "turn";
      state: CvChatState;
      ack: string | null;
      next: CvTopic | null;
      question: string | null;
      closeReason: CvCloseReason | null;
      /**
       * Borrador de repregunta del modelo, sin validar (R12-2). El chat ya lo resuelve en el estado; la
       * charla de huecos lo pasa por `safeFollowUpQuestion` cuando su código decide repreguntar.
       */
      followUpDraft: string | null;
      model: string | null;
      usedFallback: boolean;
      costUsd: number | null;
    };

/** Contexto mínimo del trabajo en curso; nunca el historial completo de la charla. */
function contextOf(state: CvChatState, topic: CvTopic): string {
  const w = topic.workIndex === null ? undefined : state.works[topic.workIndex];
  if (!w) return "";
  return [w.organization, w.title].filter((x): x is string => !!x).join(" | ");
}

function advance(
  state: CvChatState,
  ack: string | null,
  meta: {
    followUpDraft: string | null;
    model: string | null;
    usedFallback: boolean;
    costUsd: number | null;
  },
): CvInterviewOutcome {
  const next = nextCvTopic(state);
  const closeReason = cvChatCloseReason(state);
  return {
    kind: "turn",
    state,
    ack,
    next,
    question: closeReason === null && next ? cvTopicQuestion(next, state) : null,
    closeReason,
    ...meta,
  };
}

export async function runCvInterviewTurn(
  deps: { llm: LlmClient },
  p: CvInterviewParams,
): Promise<CvInterviewOutcome> {
  const input = classifyCvChatInput(p.message);
  if (input.kind === "pasted_cv") return { kind: "redirect_cv_reader" };
  if (input.kind !== "ok") {
    return { kind: "rejected", reason: input.kind };
  }
  // «Saltear»: lo resuelve el código, sin modelo ni gasto
  if (SKIP_RE.test(p.message)) {
    return advance(skipCvTopic(p.state, p.topic), null, {
      followUpDraft: null,
      model: null,
      usedFallback: false,
      costUsd: 0,
    });
  }

  // «¿Cuál dejo?» (R12-3): la respuesta (un chip o texto) la resuelve el código, sin modelo ni gasto
  if (p.state.conflict) {
    const resolved = resolveCvConflict(p.state, p.message);
    return advance(resolved.state, resolved.ack, {
      followUpDraft: null,
      model: null,
      usedFallback: false,
      costUsd: 0,
    });
  }

  // R33-04: el resumen y las situaciones de habilidades blandas se resuelven con el código, con las palabras de la
  // persona: sin modelo, sin gasto y sin nada que inventar
  if (isCvLocalTopic(p.topic.kind)) {
    return advance(applyCvAnswer(p.state, p.topic, cvLocalAnswer(p.message)), CV_FIXED_ACK, {
      followUpDraft: null,
      model: null,
      usedFallback: false,
      costUsd: 0,
    });
  }

  const r = await deps.llm.generateStructured(
    CV_INTERVIEW_TASK,
    cvInterviewTurnSchema(p.topic),
    {
      lang: "es",
      topic: p.topic.kind,
      context: contextOf(p.state, p.topic),
      message: p.message,
    },
    {
      userId: p.userId,
      label: cvChatLabel(p.conversationId),
      signal: cvChatSignal(p.signal, p.deadlineMs),
      promptVersion: CV_INTERVIEW_PROMPT,
    },
  );
  if (!r.ok) return { kind: "error", error: r.error };

  // Grounding, datos sensibles, esquema estricto y repregunta: todo en el pipeline (`applyCvModelTurn`)
  const { state, ack } = applyCvModelTurn(p.state, p.topic, p.message, r.value.object);
  return advance(state, ack, {
    followUpDraft: r.value.object.followUp ?? null,
    model: r.value.model,
    usedFallback: r.value.usedFallback,
    costUsd: r.value.costUsd,
  });
}
