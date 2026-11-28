import { schema as s } from "@job-search-os/db";
import {
  CV_COACH_DRAFT_MAX_CARDS,
  cvChatDraftHasContent,
  cvChatDraftSections,
  cvDraftExpired,
  cvDraftFits,
  parseCvChatDraft,
  parseCvCoachDraft,
  type CvChatState,
  type CvCoachCard,
  type CvDraftKind,
  type CvDraftSection,
} from "@job-search-os/pipeline";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";

/**
 * Borrador automático del CV (R33-02, tabla `cv_drafts`, rls/0075). Lo que la persona responde en los dos
 * asistentes se guarda mientras avanza; nada entra a su CV (`career_history`) hasta que lo confirma. Siempre con
 * la sesión y el `user_id` de la persona, más la RLS de la tabla: nadie lee el borrador de otra persona. Sin
 * modelo. Lo que vuelve de la base se vuelve a validar (entrada no confiable) y un borrador con más de 30 días
 * sin uso se trata como inexistente aunque la limpieza todavía no lo haya borrado.
 */

async function save(
  userId: string,
  kind: CvDraftKind,
  payload: unknown,
  now: Date,
): Promise<boolean> {
  // Tope de tamaño antes de tocar la base: coincide con el CHECK de la tabla
  if (!cvDraftFits(payload)) return false;
  await withUser(userId, (tx) =>
    tx
      .insert(s.cvDrafts)
      .values({ userId, kind, payload, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [s.cvDrafts.userId, s.cvDrafts.kind],
        set: { payload, updatedAt: now },
      }),
  );
  return true;
}

async function read(userId: string, kind: CvDraftKind) {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ payload: s.cvDrafts.payload, updatedAt: s.cvDrafts.updatedAt })
      .from(s.cvDrafts)
      .where(and(eq(s.cvDrafts.userId, userId), eq(s.cvDrafts.kind, kind)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Guarda (o reemplaza) el borrador del chat. El estado ya viene validado por el servidor. */
export function saveChatDraft(
  userId: string,
  state: CvChatState,
  now: Date = new Date(),
): Promise<boolean> {
  return save(userId, "chat", { v: 1, state }, now);
}

export type ChatDraft = { state: CvChatState; updatedAt: Date };

/** El borrador del chat, o `null` si no hay, venció o no cumple el esquema. */
export async function loadChatDraft(
  userId: string,
  now: Date = new Date(),
): Promise<ChatDraft | null> {
  const row = await read(userId, "chat");
  if (!row || cvDraftExpired(row.updatedAt, now)) return null;
  const parsed = parseCvChatDraft(row.payload);
  return parsed ? { state: parsed.state, updatedAt: row.updatedAt } : null;
}

/** Guarda las propuestas sin confirmar del coach. Sin ninguna, el borrador se borra. */
export async function saveCoachDraft(
  userId: string,
  cards: readonly CvCoachCard[],
  now: Date = new Date(),
): Promise<boolean> {
  if (cards.length === 0) {
    await discardDraft(userId, "coach");
    return true;
  }
  return save(userId, "coach", { v: 1, cards: cards.slice(0, CV_COACH_DRAFT_MAX_CARDS) }, now);
}

export type CoachDraft = { cards: CvCoachCard[]; updatedAt: Date };

export async function loadCoachDraft(
  userId: string,
  now: Date = new Date(),
): Promise<CoachDraft | null> {
  const row = await read(userId, "coach");
  if (!row || cvDraftExpired(row.updatedAt, now)) return null;
  const parsed = parseCvCoachDraft(row.payload);
  return parsed && parsed.cards.length > 0
    ? { cards: parsed.cards, updatedAt: row.updatedAt }
    : null;
}

/** Borra el borrador (al confirmar o cuando la persona elige empezar de nuevo). */
export async function discardDraft(userId: string, kind: CvDraftKind): Promise<void> {
  await withUser(userId, (tx) =>
    tx.delete(s.cvDrafts).where(and(eq(s.cvDrafts.userId, userId), eq(s.cvDrafts.kind, kind))),
  );
}

/**
 * Resumen para «Tu CV» (C-03): si hay borrador y qué secciones tiene dichas pero sin confirmar, para decir «sin
 * confirmar» en vez de «te falta». Una sola consulta.
 */
export type CvDraftSummary = {
  chat: { sections: CvDraftSection[]; updatedAt: Date } | null;
  coach: { cards: number; updatedAt: Date } | null;
  /** `true` si hay algo para retomar en alguno de los dos asistentes. */
  any: boolean;
};

/** A dónde lleva «Retomarlo»: el chat tiene prioridad; el coach retoma desde la lectura (`/cv/perfil`). */
export function cvDraftResumePath(summary: CvDraftSummary): string | null {
  if (summary.chat) return "/cv/armar";
  if (summary.coach) return "/cv/perfil";
  return null;
}

/** ¿Hay un borrador para retomar? Ante cualquier error (por ejemplo, tabla sin migrar), no. */
export async function hasCvDraft(userId: string, now: Date = new Date()): Promise<boolean> {
  return (await loadCvDraftSummary(userId, now).catch(() => null))?.any ?? false;
}

export async function loadCvDraftSummary(
  userId: string,
  now: Date = new Date(),
): Promise<CvDraftSummary> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        kind: s.cvDrafts.kind,
        payload: s.cvDrafts.payload,
        updatedAt: s.cvDrafts.updatedAt,
      })
      .from(s.cvDrafts)
      .where(and(eq(s.cvDrafts.userId, userId), sql`${s.cvDrafts.kind} in ('chat', 'coach')`)),
  );
  let chat: CvDraftSummary["chat"] = null;
  let coach: CvDraftSummary["coach"] = null;
  for (const r of rows) {
    if (cvDraftExpired(r.updatedAt, now)) continue;
    if (r.kind === "chat") {
      const d = parseCvChatDraft(r.payload);
      if (d && cvChatDraftHasContent(d.state)) {
        chat = { sections: cvChatDraftSections(d.state), updatedAt: r.updatedAt };
      }
    } else if (r.kind === "coach") {
      const d = parseCvCoachDraft(r.payload);
      if (d && d.cards.length > 0) coach = { cards: d.cards.length, updatedAt: r.updatedAt };
    }
  }
  return { chat, coach, any: chat !== null || coach !== null };
}
