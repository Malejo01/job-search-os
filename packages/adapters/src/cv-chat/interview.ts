/**
 * Un turno de la entrevista de CV (C-25, tarea `cv_interview`). Una llamada estructurada por turno (sin
 * streaming): el modelo extrae la respuesta al esquema del tema que decidió el código y suma un acuse corto.
 * La pregunta siguiente sale de una plantilla fija según el checklist: ninguna salida del modelo decide el
 * temario ni dispara una acción. El respaldo de proveedor lo hace el cliente antes de devolver nada.
 */
import {
  applyCvAnswer,
  classifyCvChatInput,
  CV_EXTRACTION_SCHEMAS,
  cvChatCloseReason,
  cvTopicQuestion,
  extractionGrounded,
  nextCvTopic,
  safeCvAck,
  skipCvTopic,
  type CvChatState,
  type CvCloseReason,
  type CvTopic,
} from "@job-search-os/pipeline";
import { z } from "zod";
import type { LlmClient, LlmError } from "../llm";
import { cvChatLabel, cvChatSignal } from "./ids";

export const CV_INTERVIEW_TASK = "cv_interview";
const SKIP_RE = /^\s*(saltear|saltearlo|paso|skip|no s[eé]|no se)\s*[.!]*\s*$/i;

export type CvInterviewParams = {
  userId: string;
  conversationId: string;
  state: CvChatState;
  topic: CvTopic;
  message: string;
  signal?: AbortSignal;
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
      model: string | null;
      usedFallback: boolean;
      costUsd: number | null;
    };

function interviewSchema(topic: CvTopic) {
  return z.strictObject({
    extraction: CV_EXTRACTION_SCHEMAS[topic.kind],
    ack: z.string().max(300).nullable(),
  });
}

/** Contexto mínimo del trabajo en curso; nunca el historial completo de la charla. */
function contextOf(state: CvChatState, topic: CvTopic): string {
  const w = topic.workIndex === null ? undefined : state.works[topic.workIndex];
  if (!w) return "";
  return [w.organization, w.title].filter((x): x is string => !!x).join(" | ");
}

function advance(
  state: CvChatState,
  ack: string | null,
  meta: { model: string | null; usedFallback: boolean; costUsd: number | null },
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
      model: null,
      usedFallback: false,
      costUsd: 0,
    });
  }

  const r = await deps.llm.generateStructured(
    CV_INTERVIEW_TASK,
    interviewSchema(p.topic),
    {
      lang: "es",
      topic: p.topic.kind,
      context: contextOf(p.state, p.topic),
      message: p.message,
    },
    { userId: p.userId, label: cvChatLabel(p.conversationId), signal: cvChatSignal(p.signal) },
  );
  if (!r.ok) return { kind: "error", error: r.error };

  const { extraction, ack } = r.value.object;
  // Lo extraído tiene que estar en lo que escribió la persona (números, nombres, tecnologías, links);
  // si no, se descarta y el tema cuenta como falla. Después vuelve a pasar por el esquema estricto.
  const grounded = extractionGrounded(extraction, p.message);
  const state = applyCvAnswer(p.state, p.topic, grounded ? extraction : null);
  return advance(state, ack ? safeCvAck(ack) : null, {
    model: r.value.model,
    usedFallback: r.value.usedFallback,
    costUsd: r.value.costUsd,
  });
}
