/**
 * Estado y pregunta de la etapa de huecos (ADR-034 §5). Puro. El estado del navegador (`ProfileGapState`) solo
 * dice qué temas la persona ya cerró y cuántas repreguntas hubo; el servidor lo vuelve a cruzar con los
 * huecos que calcula desde la base. Las repreguntas por tema se acotan acá, y los topes de USD y de turnos
 * los mide el adaptador en `llm_calls` (no se le cree al navegador).
 */
import { PROFILE_AGENT_MAX_FOLLOW_UPS } from "../limits";
import {
  profileGapQuestionSchema,
  type ProfileGapQuestion,
  type ProfileGapState,
} from "../schemas";
import { currentGap, pendingGaps, type GapTopicRef } from "./detect";
import { renderGapQuestion, type GapCareerKey, type GapTemplates } from "./templates";

export function initialGapState(): ProfileGapState {
  return { answered: [], followUps: {}, current: null };
}

/** Repreguntas hechas sobre un tema, acotadas a lo que admite el contrato. */
export function gapFollowUpsAsked(state: ProfileGapState, key: string): number {
  const n = state.followUps[key] ?? 0;
  return Math.min(Math.max(n, 0), PROFILE_AGENT_MAX_FOLLOW_UPS);
}

/** El tema queda cerrado (respondido, salteado, con «no tengo» o sin más repreguntas). */
export function closeGap(state: ProfileGapState, key: string): ProfileGapState {
  return {
    ...state,
    answered: state.answered.includes(key) ? state.answered : [...state.answered, key],
    current: state.current === key ? null : state.current,
  };
}

/** El tema sigue abierto con una repregunta más. */
export function openGapFollowUp(state: ProfileGapState, key: string): ProfileGapState {
  return {
    ...state,
    followUps: { ...state.followUps, [key]: gapFollowUpsAsked(state, key) + 1 },
    current: key,
  };
}

/** La pregunta que sigue, o `null` si no queda ningún tema. */
export function nextGapQuestion(input: {
  templates: GapTemplates;
  career: GapCareerKey;
  gaps: readonly GapTopicRef[];
  state: ProfileGapState;
}): { ref: GapTopicRef; question: ProfileGapQuestion } | null {
  const ref = currentGap(input.gaps, input.state);
  if (!ref) return null;
  const followUp = gapFollowUpsAsked(input.state, ref.key);
  const parsed = profileGapQuestionSchema.safeParse({
    key: ref.key,
    topic: ref.topic,
    question: renderGapQuestion(input.templates, input.career, ref.topic, followUp > 0, {
      organization: ref.organization,
      skill: ref.skillName,
    }),
    followUp,
    remaining: pendingGaps(input.gaps, input.state).length,
  });
  return parsed.success ? { ref, question: parsed.data } : null;
}
