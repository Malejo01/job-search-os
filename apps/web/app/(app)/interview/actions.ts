"use server";

import {
  answerInterview,
  createLogger,
  startInterview,
  type InterviewAnswerError,
  type InterviewStartError,
} from "@job-search-os/adapters";
import {
  INTERVIEW_SENIORITIES,
  interviewScoreLevel,
  type InterviewFeedbackOutput,
  type InterviewScoreLevel,
} from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSessionUserId } from "@/lib/session";
import { removeSession, withInterviewDeps } from "./server";

/**
 * Server Actions del simulador. Lo que llega del navegador se valida con zod; la persona sale de la sesión,
 * nunca del pedido. Los errores vuelven como códigos cerrados: el texto que ve la persona lo arma la pantalla,
 * nunca una excepción ni lo que devolvió el modelo.
 */
export type StartInterviewResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: InterviewStartError | "unauthorized" | "bad_request" | "server" };

export type AnswerInterviewActionResult =
  | {
      ok: true;
      position: number;
      feedback: InterviewFeedbackOutput;
      levels: Record<"clarity" | "relevance" | "star", InterviewScoreLevel>;
      truncated: boolean;
    }
  | { ok: false; error: InterviewAnswerError | "unauthorized" | "bad_request" | "server" };

const startSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("job"), jobId: z.string().uuid() }),
  z.strictObject({
    kind: z.literal("career"),
    career: z.string().trim().min(1).max(120),
    seniority: z.enum(INTERVIEW_SENIORITIES),
  }),
]);

const answerSchema = z.strictObject({
  sessionId: z.string().uuid(),
  // El recorte fino y la limpieza los hace `prepareInterviewAnswer`; esto solo acota lo que viaja
  answer: z.string().max(20_000),
});

export async function startInterviewAction(input: unknown): Promise<StartInterviewResult> {
  const userId = await activeSessionUserId();
  if (!userId) return { ok: false, error: "unauthorized" };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "bad_request" };
  try {
    const result = await withInterviewDeps(userId, (deps) =>
      startInterview(deps, { userId, source: parsed.data }),
    );
    return result.ok
      ? { ok: true, sessionId: result.value.sessionId }
      : { ok: false, error: result.error };
  } catch (e) {
    createLogger({ user_id: userId }).error(
      { err_name: e instanceof Error ? e.name : "unknown" },
      "no se pudo empezar la simulación",
    );
    return { ok: false, error: "server" };
  }
}

export type DeleteInterviewResult =
  { ok: true } | { ok: false; error: "not_found" | "unauthorized" | "bad_request" | "server" };

const deleteSchema = z.strictObject({ sessionId: z.string().uuid() });

/** Borra una simulación propia con sus respuestas. La persona sale de la sesión; RLS hace el resto. */
export async function deleteInterviewAction(input: unknown): Promise<DeleteInterviewResult> {
  const userId = await activeSessionUserId();
  if (!userId) return { ok: false, error: "unauthorized" };
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "bad_request" };
  try {
    const removed = await removeSession(userId, parsed.data.sessionId);
    if (!removed) return { ok: false, error: "not_found" };
    revalidatePath("/interview");
    return { ok: true };
  } catch (e) {
    createLogger({ user_id: userId, session_id: parsed.data.sessionId }).error(
      { err_name: e instanceof Error ? e.name : "unknown" },
      "no se pudo borrar la simulación",
    );
    return { ok: false, error: "server" };
  }
}

export async function answerInterviewAction(input: unknown): Promise<AnswerInterviewActionResult> {
  const userId = await activeSessionUserId();
  if (!userId) return { ok: false, error: "unauthorized" };
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "bad_request" };
  try {
    const result = await withInterviewDeps(userId, (deps) =>
      answerInterview(deps, { userId, ...parsed.data }),
    );
    if (!result.ok) return { ok: false, error: result.error };
    const f = result.value.feedback;
    return {
      ok: true,
      position: result.value.position,
      feedback: f,
      levels: {
        clarity: interviewScoreLevel(f.clarity),
        relevance: interviewScoreLevel(f.relevance),
        star: interviewScoreLevel(f.star),
      },
      truncated: result.value.truncated,
    };
  } catch (e) {
    createLogger({ user_id: userId, session_id: parsed.data.sessionId }).error(
      { err_name: e instanceof Error ? e.name : "unknown" },
      "no se pudo evaluar la respuesta",
    );
    return { ok: false, error: "server" };
  }
}
