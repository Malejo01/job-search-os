"use server";

import {
  ANSWER_LANGS,
  ApplicantFailure,
  createLogger,
  draftApplicationAnswers,
  draftsCapGuard,
  safeDbError,
  saveAnswer,
  saveApplicationAnswers,
  type DraftOrigin,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  looksLikeHtml,
  parseApplicationForm,
  type FormQuestion as ParsedQuestion,
} from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "./db";
import { ONBOARDING_MESSAGE } from "./evaluate-now";
import { serviceLlm } from "./llm-service";
import { isOnboardingComplete } from "./onboarding";
import { requireUserId } from "./session";

/**
 * Formulario de postulación en el detalle de la oferta (JS-053, fase 2). Acciones de servidor:
 * analizar (parser determinista), generar borradores (servicio de adapters; el modelo no decide
 * nada que no pase por su validación de fuentes) y aprobar (answer_bank + application_answers).
 * Nada se envía a ningún lado (ADR-004): la persona copia y pega.
 * Este archivo es "use server": solo exporta acciones asíncronas y tipos.
 */

export type FormAnalysis =
  | { status: "idle" }
  | { status: "error"; reason: "no_reconocido"; raw: string }
  | { status: "ok"; raw: string; isHtml: boolean; questions: ParsedQuestion[] };

export type DraftView = ParsedQuestion & {
  answer: string;
  origin: DraftOrigin;
  /** Claves de candidate_facts que respaldan el borrador. Vacío en origen "modelo" = sin fuente. */
  sources: string[];
  note: string | null;
};

export type DraftsResult =
  { ok: true; drafts: DraftView[]; llmError: string | null } | { ok: false; error: string };

export type ApproveResult = { ok: true; replaced: boolean } | { ok: false; error: string };

const jobIdSchema = z.uuid();
// Un carácter más que el tope del parser: si se pasa, el parser lo rechaza en vez de truncarlo.
const MAX_RAW = 50_001;

function failureMessage(e: unknown): string {
  if (e instanceof ApplicantFailure) {
    const messages: Record<ApplicantFailure["code"], string> = {
      job_not_found: "No se encontró la oferta.",
      profile_not_found: "Falta cargar el perfil.",
      empty_question: "Hay una pregunta o una respuesta vacía.",
      empty_form: "No hay preguntas para responder.",
    };
    return messages[e.code];
  }
  return "No se pudo completar la operación.";
}

/** "Analizar": corre el parser en el servidor. No guarda nada. */
export async function analyzeFormAction(
  _prev: FormAnalysis,
  formData: FormData,
): Promise<FormAnalysis> {
  await requireUserId();
  const raw = String(formData.get("raw") ?? "").slice(0, MAX_RAW);
  const parsed = parseApplicationForm(raw);
  if (!parsed.ok) return { status: "error", reason: parsed.error.reason, raw };
  return { status: "ok", raw, isHtml: looksLikeHtml(raw), questions: parsed.value.questions };
}

/**
 * "Generar borradores". Se vuelve a parsear el pegado en el servidor en vez de confiar en las
 * preguntas que manda el cliente. Las lecturas van con el rol de la app y RLS; el cliente LLM usa
 * la conexión de servicio solo para el registro de llamadas (igual que la evaluación inmediata).
 */
export async function generateDraftsAction(input: {
  jobId: string;
  raw: string;
}): Promise<DraftsResult> {
  const userId = await requireUserId();
  // Sin onboarding no se llama al modelo (JS-109): esta acción tampoco pasa por el gate del layout
  if (!(await isOnboardingComplete(userId))) return { ok: false, error: `${ONBOARDING_MESSAGE}.` };
  const jobId = jobIdSchema.safeParse(input.jobId);
  if (!jobId.success) return { ok: false, error: "Oferta inválida." };
  const parsed = parseApplicationForm(String(input.raw ?? "").slice(0, MAX_RAW));
  if (!parsed.ok) return { ok: false, error: "No se reconoció el formulario." };

  const questions = parsed.value.questions;
  const logger = createLogger({ user_id: userId, job_id: jobId.data, trigger: "borradores" });
  let service: ReturnType<typeof createDb> | null = null;
  try {
    const conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    service = conn;
    const result = await withUser(userId, (tx) =>
      draftApplicationAnswers(
        tx,
        {
          userId,
          jobId: jobId.data,
          questions: questions.map((q) => ({
            id: q.id,
            text: q.options?.length ? `${q.label} (opciones: ${q.options.join(" / ")})` : q.label,
          })),
        },
        serviceLlm(conn.db, logger),
        draftsCapGuard(conn.db, userId),
      ),
    );
    const byId = new Map(result.drafts.map((d) => [d.question_id, d]));
    const drafts = questions.map((q): DraftView => {
      const d = byId.get(q.id);
      return {
        ...q,
        answer: d?.draft ?? "",
        origin: d?.origin ?? "modelo",
        sources: d?.sources ?? [],
        note: d?.note ?? null,
      };
    });
    logger.info(
      { questions: questions.length, llm_error: result.llm_error?.kind ?? null },
      "borradores generados",
    );
    return {
      ok: true,
      drafts,
      llmError:
        result.cap_message ??
        (result.llm_error ? `el modelo no respondió (${result.llm_error.kind})` : null),
    };
  } catch (e) {
    if (!(e instanceof ApplicantFailure)) {
      logger.error({ err: safeDbError(e) }, "borradores fallaron");
    }
    return { ok: false, error: failureMessage(e) };
  } finally {
    await service?.close();
  }
}

const approveSchema = z.object({
  jobId: z.uuid(),
  lang: z.enum(ANSWER_LANGS),
  question: z.string().trim().min(1).max(2_000),
  answer: z.string().trim().min(1).max(10_000),
  /** Todo lo aprobado hasta ahora, incluida esta: application_answers se reemplaza entero. */
  approved: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(2_000),
        answer: z.string().trim().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * Aprobar una respuesta: la guarda en answer_bank (reutilizable en otras ofertas) y deja el
 * formulario aprobado hasta ahora en application_answers, en la misma transacción.
 */
export async function approveAnswerAction(
  input: z.input<typeof approveSchema>,
): Promise<ApproveResult> {
  const userId = await requireUserId();
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "La respuesta no es válida (¿vacía o demasiado larga?)." };
  const { jobId, lang, question, answer, approved } = parsed.data;
  try {
    const out = await withUser(userId, async (tx) => {
      const saved = await saveAnswer(tx, { userId, question, answer, lang, jobId });
      await saveApplicationAnswers(tx, { userId, jobId, qa: approved });
      return saved;
    });
    createLogger({ user_id: userId, job_id: jobId }).info(
      { approved: approved.length, replaced: out.replaced },
      "respuesta de formulario aprobada",
    );
    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, replaced: out.replaced };
  } catch (e) {
    return { ok: false, error: failureMessage(e) };
  }
}
