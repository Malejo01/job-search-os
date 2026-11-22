import type { Db } from "@job-search-os/db";
import {
  err,
  INTERVIEW_QUESTION_COUNT,
  INTERVIEW_SENIORITY_LABELS,
  interviewProgress,
  ok,
  prepareInterviewAnswer,
  type InterviewContext,
  type InterviewFeedbackOutput,
  type InterviewSeniority,
  type Result,
} from "@job-search-os/pipeline";
import { randomUUID } from "node:crypto";
import type { Logger } from "../logger";
import type { LlmClient } from "../llm/types";
import { generateInterviewFeedback, generateInterviewQuestions } from "./generate";
import {
  releaseInterviewReservation,
  reserveInterviewFeedback,
  reserveInterviewStart,
  type InterviewCaps,
} from "./reserve";
import {
  insertInterviewAnswer,
  insertInterviewSession,
  loadInterviewJob,
  loadInterviewSession,
  type InterviewSessionRow,
} from "./store";

/**
 * Orquestación del simulador: reserva de gasto, llamada al modelo y persistencia. El modelo propone preguntas
 * y puntajes; este código valida, decide si se puede seguir y guarda. Nada de lo que devuelve el modelo
 * dispara otra acción.
 */
export type InterviewDeps = {
  llm: LlmClient;
  /** Conexión de servicio: las reservas y los topes miran `llm_calls` de todas las personas. */
  reserveDb: Db;
  /** Corre `fn` con el rol de la app y `app.user_id` fijado (RLS). Una transacción corta por vez. */
  withUser: <T>(userId: string, fn: (db: Db) => Promise<T>) => Promise<T>;
  caps?: InterviewCaps;
  now?: () => Date;
  newId?: () => string;
  logger?: Logger;
};

export type InterviewSource =
  | { kind: "job"; jobId: string }
  | { kind: "career"; career: string; seniority: InterviewSeniority };

export type InterviewStartError =
  /** La oferta no existe o no es de la persona. */
  | "not_found"
  /** Ya empezó las simulaciones que entran en un día. */
  | "daily_limit"
  /** Tope de gasto global o de la persona. */
  | "capped"
  | "llm_failed";

export type InterviewAnswerError =
  "not_found" | "empty" | "too_short" | "finished" | "capped" | "busy" | "llm_failed";

const MAX_CAREER_CHARS = 120;
const MAX_TITLE_CHARS = 200;

const clip = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** Contexto de la simulación para los prompts. La descripción del aviso se relee: no se guarda copia. */
async function contextFor(
  deps: InterviewDeps,
  userId: string,
  session: Pick<InterviewSessionRow, "sourceKind" | "jobId" | "career" | "seniority" | "title">,
): Promise<InterviewContext> {
  if (session.sourceKind === "career") {
    return {
      kind: "career",
      career: session.career ?? session.title,
      seniority: (session.seniority as InterviewSeniority | null) ?? "junior",
    };
  }
  const job = session.jobId
    ? await deps.withUser(userId, (db) => loadInterviewJob(db, userId, session.jobId!))
    : null;
  return job
    ? { kind: "job", title: job.title, company: job.company, description: job.description }
    : { kind: "job", title: session.title, company: "", description: null };
}

/**
 * Empieza una simulación: reserva cupo (tope de 2 por día y topes de gasto), pide las 5 preguntas, guarda la
 * simulación y suelta la reserva. Si algo falla antes de guardar, no queda simulación y no cuenta para el día.
 */
export async function startInterview(
  deps: InterviewDeps,
  input: { userId: string; source: InterviewSource },
): Promise<Result<{ sessionId: string }, InterviewStartError>> {
  const { userId, source } = input;
  const log = deps.logger?.child({ user_id: userId });

  let context: InterviewContext;
  let stored: InterviewSource;
  let title: string;
  if (source.kind === "job") {
    const job = await deps.withUser(userId, (db) => loadInterviewJob(db, userId, source.jobId));
    if (!job) return err("not_found");
    context = { kind: "job", title: job.title, company: job.company, description: job.description };
    stored = source;
    title = clip(`${job.title} · ${job.company}`, MAX_TITLE_CHARS);
  } else {
    const career = clip(source.career, MAX_CAREER_CHARS);
    if (career === "") return err("not_found");
    context = { kind: "career", career, seniority: source.seniority };
    stored = { kind: "career", career, seniority: source.seniority };
    title = clip(`${career} · ${INTERVIEW_SENIORITY_LABELS[source.seniority]}`, MAX_TITLE_CHARS);
  }

  const sessionId = (deps.newId ?? randomUUID)();
  const reservation = await reserveInterviewStart(deps.reserveDb, {
    ...deps.caps,
    userId,
    sessionId,
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!reservation.ok) {
    log?.info({ session_id: sessionId, reason: reservation.reason }, "simulación frenada");
    return err(reservation.reason === "daily_limit" ? "daily_limit" : "capped");
  }

  try {
    const questions = await generateInterviewQuestions(deps.llm, { userId, sessionId, context });
    if (!questions.ok) {
      log?.warn({ session_id: sessionId, llm_kind: questions.error.llmKind }, "sin preguntas");
      return err("llm_failed");
    }
    await deps.withUser(userId, (db) =>
      insertInterviewSession(db, {
        id: sessionId,
        userId,
        source: stored,
        title,
        questions: questions.value.questions,
      }),
    );
    return ok({ sessionId });
  } finally {
    // Después de guardar: así el cupo del día no tiene un hueco entre la reserva y la fila
    await releaseInterviewReservation(deps.reserveDb, reservation.reservationId);
  }
}

export type InterviewAnswerResult = {
  position: number;
  feedback: InterviewFeedbackOutput;
  progress: { current: number; total: number; done: boolean };
  truncated: boolean;
};

/**
 * Evalúa la respuesta a la pregunta que toca (la siguiente a las ya respondidas). El orden lo decide el
 * código: el navegador no elige qué pregunta contesta.
 */
export async function answerInterview(
  deps: InterviewDeps,
  input: { userId: string; sessionId: string; answer: string },
): Promise<Result<InterviewAnswerResult, InterviewAnswerError>> {
  const { userId, sessionId } = input;
  const log = deps.logger?.child({ user_id: userId, session_id: sessionId });

  const prepared = prepareInterviewAnswer(input.answer);
  if (!prepared.ok) return err(prepared.error);

  const loaded = await deps.withUser(userId, (db) => loadInterviewSession(db, userId, sessionId));
  if (!loaded) return err("not_found");
  const position = loaded.answers.length;
  if (loaded.session.status === "terminada" || position >= INTERVIEW_QUESTION_COUNT) {
    return err("finished");
  }
  const question = loaded.session.questions[position];
  if (!question) return err("not_found");

  const reservation = await reserveInterviewFeedback(deps.reserveDb, {
    ...deps.caps,
    userId,
    sessionId,
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!reservation.ok) {
    log?.info({ reason: reservation.reason }, "respuesta frenada");
    return err(reservation.reason === "concurrent" ? "busy" : "capped");
  }

  try {
    const context = await contextFor(deps, userId, loaded.session);
    const generated = await generateInterviewFeedback(deps.llm, {
      userId,
      sessionId,
      context,
      question,
      answer: prepared.value.text,
    });
    if (!generated.ok) {
      log?.warn({ llm_kind: generated.error.llmKind }, "sin devolución");
      return err("llm_failed");
    }
    const saved = await deps.withUser(userId, (db) =>
      insertInterviewAnswer(db, {
        userId,
        sessionId,
        position,
        answer: prepared.value.text,
        feedback: generated.value.feedback,
        model: generated.value.model,
        isLast: position === INTERVIEW_QUESTION_COUNT - 1,
      }),
    );
    // Dos envíos a la vez de la misma pregunta: gana el primero, el segundo ve la simulación avanzada
    if (saved === "duplicate") return err("busy");
    return ok({
      position,
      feedback: generated.value.feedback,
      progress: interviewProgress(position + 1),
      truncated: prepared.value.truncated,
    });
  } finally {
    await releaseInterviewReservation(deps.reserveDb, reservation.reservationId);
  }
}
