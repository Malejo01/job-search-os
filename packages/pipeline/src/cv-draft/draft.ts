/**
 * Borrador automático del CV (R33-02, C-03 y C-05). Lógica pura, sin I/O: lo que la persona responde en los dos
 * asistentes (el chat de `/cv/armar` y el coach de `/cv/coach`) se guarda como borrador mientras avanza. Un
 * borrador NO es el CV: nada entra a `career_history` hasta que la persona lo confirma. Se borra solo a los 30
 * días sin uso y se va con la cuenta.
 *
 * - `chat`: el estado de la charla (`CvChatState`), que ya está acotado y validado.
 * - `coach`: las propuestas (tarjetas) que todavía no confirmó. La charla en sí no se guarda.
 *
 * Lo que vuelve de la base se trata como entrada no confiable: se vuelve a validar con estos esquemas.
 */
import { z } from "zod";
import { CV_CHAT_STATE_SCHEMA } from "../cv-chat/state-schema";
import type { CvChatState } from "../cv-chat/state";
import { cvCoachCardSchema } from "../cv-coach/turn/cards";

export const CV_DRAFT_KINDS = ["chat", "coach"] as const;
export type CvDraftKind = (typeof CV_DRAFT_KINDS)[number];

/** Días sin uso después de los cuales el borrador se borra solo. */
export const CV_DRAFT_RETENTION_DAYS = 30;

/** Tope del borrador serializado, en bytes. Coincide con el CHECK de la tabla `cv_drafts`. */
export const CV_DRAFT_MAX_BYTES = 60_000;

/** Propuestas sin confirmar que el coach conserva en el borrador. */
export const CV_COACH_DRAFT_MAX_CARDS = 12;

export const cvChatDraftSchema = z.strictObject({
  v: z.literal(1),
  state: CV_CHAT_STATE_SCHEMA,
});
export type CvChatDraft = z.infer<typeof cvChatDraftSchema>;

export const cvCoachDraftSchema = z.strictObject({
  v: z.literal(1),
  cards: z.array(cvCoachCardSchema).max(CV_COACH_DRAFT_MAX_CARDS),
});
export type CvCoachDraft = z.infer<typeof cvCoachDraftSchema>;

/** Borrador del chat validado, o `null` si no cumple el esquema (se ignora, no se repara). */
export function parseCvChatDraft(raw: unknown): CvChatDraft | null {
  const p = cvChatDraftSchema.safeParse(raw);
  return p.success ? (p.data as CvChatDraft) : null;
}

export function parseCvCoachDraft(raw: unknown): CvCoachDraft | null {
  const p = cvCoachDraftSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** ¿Cabe en el tope? Cuenta bytes (UTF-8), no letras. Un valor que no se puede serializar no cabe. */
export function cvDraftFits(payload: unknown): boolean {
  try {
    const text = JSON.stringify(payload);
    if (typeof text !== "string") return false;
    return new TextEncoder().encode(text).length <= CV_DRAFT_MAX_BYTES;
  } catch {
    return false;
  }
}

/**
 * ¿Pasaron 30 días sin uso? `updatedAt` es la última vez que se guardó o retomó. Una fecha inválida cuenta como
 * vencida (falla cerrado: el borrador se ignora y la limpieza lo borra).
 */
export function cvDraftExpired(
  updatedAt: Date,
  now: Date,
  days: number = CV_DRAFT_RETENTION_DAYS,
): boolean {
  const t = updatedAt.getTime();
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t >= days * 24 * 60 * 60 * 1000;
}

/** Secciones de «Tu CV» que el borrador del chat ya tiene dichas pero sin confirmar. */
export type CvDraftSection = "resumen" | "experiencia" | "estudios";

const has = (s: string | null | undefined): boolean => !!s && s.trim() !== "";

/**
 * Qué hay sin confirmar en el borrador del chat, para que «Tu CV» diga «sin confirmar» en vez de «te falta»
 * (C-03). Solo cuenta lo dicho en la charla: lo que ya estaba confirmado (`confirmed`) o sembrado desde el perfil
 * (puesto, habilidades, idiomas y links) no es borrador. Un trabajo cuenta cuando tiene empresa o cargo.
 */
export function cvChatDraftSections(s: CvChatState): CvDraftSection[] {
  const out: CvDraftSection[] = [];
  // R33-04: lo que contó para el resumen profesional (o el borrador del resumen que ya armó) está sin confirmar
  if (
    has(s.summary.experience) ||
    has(s.summary.goal) ||
    has(s.summary.strengths) ||
    has(s.summary.text)
  ) {
    out.push("resumen");
  }
  const work =
    s.works.some((w) => has(w.organization) || has(w.title)) || s.projects.some((p) => has(p.name));
  if (work) out.push("experiencia");
  if (s.education.length + s.certifications.length > 0) out.push("estudios");
  return out;
}

/** ¿Vale la pena ofrecer «Retomarlo»? Hay una sección dicha o al menos una respuesta dada. */
export function cvChatDraftHasContent(s: CvChatState): boolean {
  return cvChatDraftSections(s).length > 0 || s.turns > 0;
}
