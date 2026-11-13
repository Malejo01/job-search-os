import {
  CV_FOLLOWUP_MAX,
  PROFILE_AGENT_MAX_FOLLOW_UPS,
  buildGapCard,
  buildSkillLevelCard,
  classifyCvChatInput,
  initialCvChatState,
  isGapDeclined,
  screenProfileAnswer,
  shouldFollowUp,
  type CvChatState,
  type CvTopic,
  type GapCardResult,
  type GapExtraction,
  type GapHistoryRow,
  type GapTopicRef,
  type ProfileGapAnswer,
  type ProfileGapCard,
  type ProfileSensitiveKind,
} from "@job-search-os/pipeline";
import type { LlmClient, LlmError } from "../../llm";
import { runCvInterviewTurn } from "../../cv-chat/interview";

/**
 * Un turno de la etapa de huecos (ADR-034 §1 y §2). Una respuesta de la persona → como mucho una llamada a
 * `cv_interview` (la misma tarea y el mismo prompt v2 del chat de CV, sin cambios) que solo EXTRAE lo que la
 * persona dijo, y el código decide el resto: tarjeta, repregunta o cierre. El modelo no redacta preguntas.
 *
 * No guarda nada: devuelve una tarjeta para confirmar. «No tengo», el nivel de una skill (botones) y las
 * respuestas que se rechazan antes (vacía, muy larga, un CV pegado, una instrucción escondida o un dato
 * sensible) no llaman al modelo.
 */
export type GapTurnParams = {
  userId: string;
  /** `flowId` del ticket: el `label` de `llm_calls` es `cv:<flowId>`. */
  flowId: string;
  ref: GapTopicRef;
  /** Fila actual de `career_history` (temas de trabajo); `null` en `skill_level`. */
  row: GapHistoryRow | null;
  answer: ProfileGapAnswer;
  /** Repreguntas ya hechas sobre este tema (0 a 2). */
  followUpsAsked: number;
  signal?: AbortSignal;
  /** Solo para tests. */
  deadlineMs?: number;
};

export type GapRejectReason =
  "empty" | "too_long" | "injection" | "pasted_cv" | "sensitive" | "bad_answer";

export type GapTurnOutcome =
  | { kind: "rejected"; reason: GapRejectReason; sensitive?: ProfileSensitiveKind[] }
  | { kind: "error"; error: LlmError }
  | {
      kind: "result";
      /** Tarjeta para confirmar, o `null` si la respuesta no cambia nada. */
      card: ProfileGapCard | null;
      /** Por qué no hay tarjeta (`sensitive`, `injection` descartan lo escrito). */
      cardReason: Extract<GapCardResult, { ok: false }>["reason"] | null;
      /** Hay que repreguntar sobre el mismo tema (el código lo decide; tope de 2). */
      followUp: boolean;
      declined: boolean;
      usedModel: boolean;
      model: string | null;
      costUsd: number | null;
    };

const result = (over: Partial<Extract<GapTurnOutcome, { kind: "result" }>>): GapTurnOutcome => ({
  kind: "result",
  card: null,
  cardReason: null,
  followUp: false,
  declined: false,
  usedModel: false,
  model: null,
  costUsd: null,
  ...over,
});

/**
 * Estado de una charla de una sola fila: lo que ya sabemos de ese trabajo para que la respuesta se sume a
 * lo existente en vez de pisarlo. `followUps` se fija en el tope para que `cv_interview` nunca decida por su
 * cuenta repreguntar: la repregunta la decide `shouldFollowUp` y el texto sale de la plantilla.
 */
function scratchState(row: GapHistoryRow, topic: CvTopic): CvChatState {
  return {
    ...initialCvChatState(),
    works: [
      {
        organization: row.organization,
        title: row.title,
        startMonth: row.startMonth,
        endMonth: row.endMonth,
        isCurrent: false,
        duties: [],
        achievement: null,
      },
    ],
    followUps: { [topic.key]: CV_FOLLOWUP_MAX },
  };
}

function extractionOf(state: CvChatState, topic: CvTopic): GapExtraction | null {
  // Una respuesta que no pasó el esquema, o que el código no pudo anclar al texto de la persona, cuenta falla
  if ((state.failures[topic.key] ?? 0) > 0) return null;
  const w = state.works[0];
  if (!w) return null;
  switch (topic.kind) {
    case "dates":
      return {
        topic: "dates",
        startMonth: w.startMonth,
        endMonth: w.isCurrent ? null : w.endMonth,
        isCurrent: w.isCurrent,
      };
    case "duties":
      return { topic: "duties", duties: w.duties };
    case "achievement":
      return { topic: "achievement", achievement: w.achievement };
    default:
      return null;
  }
}

export async function runGapTurn(
  deps: { llm: LlmClient },
  p: GapTurnParams,
): Promise<GapTurnOutcome> {
  const asked = Math.min(Math.max(p.followUpsAsked, 0), PROFILE_AGENT_MAX_FOLLOW_UPS);

  // Nivel de una skill: botones, sin modelo
  if (p.answer.kind === "level") {
    if (p.ref.topic !== "skill_level") return { kind: "rejected", reason: "bad_answer" };
    const card = buildSkillLevelCard(p.ref, p.answer.level);
    return result({ card: card.ok ? card.card : null, cardReason: card.ok ? null : card.reason });
  }
  // «No tengo»: cierra el tema, sin repreguntar y sin modelo
  if (isGapDeclined(p.answer)) return result({ declined: true });
  if (p.answer.kind !== "text") return { kind: "rejected", reason: "bad_answer" };
  // Un nivel de skill no se contesta con texto; un tema de trabajo necesita su fila
  if (p.ref.topic === "skill_level" || p.row === null || p.ref.historyId !== p.row.id) {
    return { kind: "rejected", reason: "bad_answer" };
  }

  const message = p.answer.text;
  const input = classifyCvChatInput(message);
  if (input.kind === "empty" || input.kind === "too_long" || input.kind === "injection") {
    return { kind: "rejected", reason: input.kind };
  }
  if (input.kind === "pasted_cv") return { kind: "rejected", reason: "pasted_cv" };
  // Datos sensibles: la respuesta no llega al modelo ni se guarda; la persona la reescribe o dice «no tengo»
  const sensitive = screenProfileAnswer(message);
  if (sensitive.length > 0) return { kind: "rejected", reason: "sensitive", sensitive };

  const topic: CvTopic = { kind: p.ref.topic, key: `w0:${p.ref.topic}`, workIndex: 0 };
  const out = await runCvInterviewTurn(
    { llm: deps.llm },
    {
      userId: p.userId,
      conversationId: p.flowId,
      state: scratchState(p.row, topic),
      topic,
      message,
      signal: p.signal,
      deadlineMs: p.deadlineMs,
    },
  );
  if (out.kind === "error") return { kind: "error", error: out.error };
  if (out.kind === "redirect_cv_reader") return { kind: "rejected", reason: "pasted_cv" };
  if (out.kind === "rejected") return { kind: "rejected", reason: out.reason };
  // «Saltear» y parecidos los resuelve `cv_interview` sin modelo: es lo mismo que «no tengo»
  if (out.model === null) return result({ declined: true });

  const extraction = extractionOf(out.state, topic);
  const card = buildGapCard(p.ref, extraction, p.row);
  return result({
    card: card.ok ? card.card : null,
    cardReason: card.ok ? null : card.reason,
    followUp: shouldFollowUp({ topic: p.ref.topic, extraction, card, asked }),
    usedModel: true,
    model: out.model,
    costUsd: out.costUsd,
  });
}
