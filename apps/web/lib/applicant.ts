import {
  getCandidateProfile,
  listAnswers,
  saveAnswer,
  saveApplicationAnswers,
  type AnswerLang,
} from "@job-search-os/adapters";
import { withUser } from "./db";

/**
 * Contexto para responder formularios de postulación (JS-053), con el rol de la app y RLS.
 * Lo usa el servidor MCP; la lógica está en adapters/applicant y el cálculo del sueldo en el pipeline.
 */
export function candidateProfile(userId: string, jobId: string | null) {
  return withUser(userId, (tx) => getCandidateProfile(tx, { userId, jobId }));
}

export function answersFromBank(
  userId: string,
  opts: { query?: string; lang?: AnswerLang; limit: number },
) {
  return withUser(userId, (tx) => listAnswers(tx, { userId, ...opts }));
}

export function approveAnswer(
  userId: string,
  input: { question: string; answer: string; lang: AnswerLang; jobId: string | null },
) {
  return withUser(userId, (tx) => saveAnswer(tx, { userId, ...input }));
}

export function saveFormAnswers(
  userId: string,
  jobId: string,
  qa: { question: string; answer: string }[],
) {
  return withUser(userId, (tx) => saveApplicationAnswers(tx, { userId, jobId, qa }));
}
