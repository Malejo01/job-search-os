/**
 * Un turno de la charla del coach de CV (R12-9, ADR-038 §2, §3, §5 y §9). Una respuesta de la persona →
 * como mucho **una** llamada a `cv_coach_turn` (sin streaming), que extrae lo que dijo y propone el texto de
 * la próxima pregunta. El resto lo decide el código (`applyCoachTurn`): tarjetas, problema resuelto,
 * repregunta, siguiente problema, acuse y contradicción.
 *
 * No guarda nada: devuelve tarjetas para confirmar. No llaman al modelo: «Ya está, armalo», «no tengo» (el
 * botón o un texto corto), elegir una opción de una contradicción, y las respuestas que se rechazan antes
 * (vacía, muy larga, un CV pegado, una instrucción escondida, un dato sensible). Antes de llamar: el CV
 * confirmado pasa por `detectCvInjection` (falla cerrado) y se reserva el paso `turn` con la redacción
 * reservada (`reserveCvCoachStep`): al llegar a un tope, la persona va al cierre con lo que confirmó.
 */
import {
  applyCoachTurn,
  classifyCvChatInput,
  cvCoachCapNotice,
  cvDeclined,
  detectCvInjection,
  finishCoachChat,
  nextCoachIssue,
  profileAgentWindows,
  screenProfileAnswer,
  type CoachTurnError,
  type CoachTurnInput,
  type CoachTurnResult,
  type CoachTurnSetup,
  type CvCoachAnswer,
  type CvCoachCap,
  type CvCoachCapNotice,
  type CvCoachItem,
  type CvCoachState,
  type CvIssue,
  type ProfileSensitiveKind,
  cvCoachTurnOutputSchema,
} from "@job-search-os/pipeline";
import type { Db } from "@job-search-os/db";
import type { LlmClient, LlmError } from "../../llm";
import { cvChatLabel, cvChatSignal } from "../../cv-chat/ids";
import {
  CV_COACH_TURN_TASK,
  releaseCvCoachReservation,
  reserveCvCoachStep,
  type CvCoachLimits,
  type CvCoachReject,
} from "../reserve";
import { loadCoachFallbacks, type CoachFallbacksError } from "./templates";
import { coachCvInjectionText, coachTurnVars } from "./vars";

/** Versión vigente del prompt del turno. El modelo sale de `model_routing`. */
export const CV_COACH_TURN_PROMPT = "cv_coach_turn@v1";
/** «No tengo» escrito con pocas palabras se resuelve sin modelo; uno largo puede traer datos de otro tema. */
const SHORT_DECLINE_MAX_CHARS = 40;

/** La reserva del paso `turn`, inyectable para tests. La real es `dbCoachTurnReserve`. */
export type CoachTurnReserve = {
  reserve(input: {
    userId: string;
    label: string;
    now: Date;
  }): Promise<{ ok: true; reservationId: string | null } | { ok: false; reject: CvCoachReject }>;
  release(input: { userId: string; reservationId: string | null }): Promise<void>;
};

/** Reserva contra `llm_calls` (ADR-038 §9): topes de la charla con la redacción reservada, persona y día. */
export function dbCoachTurnReserve(
  db: Db,
  opts: {
    dailyCapUsd: number;
    limits?: CvCoachLimits;
  },
): CoachTurnReserve {
  return {
    async reserve(input) {
      const r = await reserveCvCoachStep(db, {
        userId: input.userId,
        label: input.label,
        step: "turn",
        now: input.now,
        daySince: profileAgentWindows(input.now).daySince,
        dailyCapUsd: opts.dailyCapUsd,
        limits: opts.limits,
      });
      return r.ok ? { ok: true, reservationId: r.reservationId } : { ok: false, reject: r.reject };
    },
    async release(input) {
      // suelta bajo el lock de la persona (26), como la reserva
      await releaseCvCoachReservation(db, input);
    },
  };
}

export type CoachTurnParams = {
  userId: string;
  /** `flowId` del ticket del agente de perfil: el `label` de `llm_calls` es `cv:<flowId>`. */
  flowId: string;
  /** Lista ya verificada (firma, dueño y vencimiento) por el llamador. */
  issues: readonly CvIssue[];
  /** Puesto objetivo de la lista firmada. */
  target: string;
  /** Ítems confirmados, leídos con RLS. */
  items: readonly CvCoachItem[];
  /** `slug` → nombre de las skills de la taxonomía que nombran los problemas. */
  skillNames: Readonly<Record<string, string>>;
  /** `slug` → alias de esas skills en la taxonomía (opcional): evita repreguntar una skill ya mostrada. */
  skillAliases?: Readonly<Record<string, readonly string[]>>;
  state: CvCoachState;
  answer: CvCoachAnswer;
  now: Date;
  signal?: AbortSignal;
  /** Solo para tests. */
  deadlineMs?: number;
};

export type CoachTurnRejectReason =
  | "empty"
  | "too_long"
  | "injection"
  | "pasted_cv"
  | "sensitive"
  /** El CV confirmado trae una instrucción escondida: no se llama al modelo. */
  | "cv_injection"
  | CoachTurnError;

export type CoachTurnOutcome =
  | { kind: "rejected"; reason: CoachTurnRejectReason; sensitive?: ProfileSensitiveKind[] }
  /** Las plantillas no cargan: falla cerrado. */
  | { kind: "templates"; error: CoachFallbacksError }
  /** El proveedor y su respaldo fallaron: el estado no cambia. */
  | { kind: "error"; error: LlmError }
  /** Un tope: mensaje fijo y la charla pasa al cierre con lo confirmado. */
  | { kind: "cap"; reject: CvCoachReject; notice: CvCoachCapNotice; state: CvCoachState }
  /** «Ya está, armalo». */
  | { kind: "finished"; state: CvCoachState }
  | {
      kind: "turn";
      result: CoachTurnResult;
      usedModel: boolean;
      model: string | null;
      costUsd: number | null;
    };

const COACH_CAPS: readonly string[] = ["turnos", "diagnosticos", "charla"];

/** El aviso del tope: los del coach tienen el suyo; persona-día y global usan el de la charla. */
function capNotice(reject: CvCoachReject): CvCoachCapNotice {
  return cvCoachCapNotice(COACH_CAPS.includes(reject) ? (reject as CvCoachCap) : "charla");
}

function pure(setup: CoachTurnSetup, state: CvCoachState, input: CoachTurnInput): CoachTurnOutcome {
  const r = applyCoachTurn(setup, state, input);
  if (!r.ok) return { kind: "rejected", reason: r.error };
  return { kind: "turn", result: r.value, usedModel: false, model: null, costUsd: null };
}

export async function runCoachTurn(
  deps: { llm: LlmClient; reserve: CoachTurnReserve; fallbacksDir?: string },
  p: CoachTurnParams,
): Promise<CoachTurnOutcome> {
  if (p.answer.kind === "finish") return { kind: "finished", state: finishCoachChat(p.state) };

  const fallbacks = loadCoachFallbacks(deps.fallbacksDir);
  if (!fallbacks.ok) return { kind: "templates", error: fallbacks.error };
  const setup: CoachTurnSetup = {
    items: p.items,
    skillNames: p.skillNames,
    ...(p.skillAliases ? { skillAliases: p.skillAliases } : {}),
    target: p.target,
    issues: p.issues,
    fallbacks: fallbacks.value,
  };
  const answer = p.answer;
  if (answer.kind === "choice") {
    return pure(setup, p.state, { kind: "choice", issueId: answer.issueId, choice: answer.choice });
  }
  if (answer.kind === "none")
    return pure(setup, p.state, { kind: "declined", issueId: answer.issueId });

  // El foco tiene que ser el del estado antes de gastar nada
  const focus = p.issues.find((i) => i.id === p.state.current);
  if (p.state.stage === "done" || !focus) return { kind: "rejected", reason: "charla_cerrada" };
  if (focus.id !== answer.issueId) return { kind: "rejected", reason: "foco_invalido" };

  const message = answer.text;
  const input = classifyCvChatInput(message);
  if (input.kind !== "ok") return { kind: "rejected", reason: input.kind };
  // Datos sensibles: no llegan al modelo ni se guardan; la persona reescribe o dice «no tengo»
  const sensitive = screenProfileAnswer(message);
  if (sensitive.length > 0) return { kind: "rejected", reason: "sensitive", sensitive };
  if (cvDeclined(message) && message.trim().length <= SHORT_DECLINE_MAX_CHARS) {
    return pure(setup, p.state, { kind: "declined", issueId: focus.id });
  }
  // El CV confirmado también entra al prompt: con una instrucción escondida, no se llama (falla cerrado)
  if (detectCvInjection(coachCvInjectionText(setup)).hit) {
    return { kind: "rejected", reason: "cv_injection" };
  }

  const label = cvChatLabel(p.flowId);
  const reservation = await deps.reserve.reserve({ userId: p.userId, label, now: p.now });
  if (!reservation.ok) {
    return {
      kind: "cap",
      reject: reservation.reject,
      notice: capNotice(reservation.reject),
      state: finishCoachChat(p.state),
    };
  }
  let r;
  try {
    const next = nextCoachIssue(
      p.issues.filter((i) => i.id !== focus.id),
      p.state,
    );
    r = await deps.llm.generateStructured(
      CV_COACH_TURN_TASK,
      cvCoachTurnOutputSchema,
      coachTurnVars({
        ctx: setup,
        focus,
        next,
        followUp: p.state.followUps > 0 || p.state.failures > 0,
        message,
        today: p.now.toISOString().slice(0, 10),
      }),
      {
        userId: p.userId,
        label,
        signal: cvChatSignal(p.signal, p.deadlineMs),
        promptVersion: CV_COACH_TURN_PROMPT,
      },
    );
  } finally {
    await deps.reserve.release({ userId: p.userId, reservationId: reservation.reservationId });
  }
  if (!r.ok) return { kind: "error", error: r.error };

  const applied = applyCoachTurn(setup, p.state, {
    kind: "model",
    issueId: focus.id,
    message,
    output: r.value.object,
  });
  if (!applied.ok) return { kind: "rejected", reason: applied.error };
  return {
    kind: "turn",
    result: applied.value,
    usedModel: true,
    model: r.value.model,
    costUsd: r.value.costUsd,
  };
}
