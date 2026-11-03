import {
  isFeedbackStatus,
  type FeedbackAction,
  type FeedbackStatus,
  type TriageRow,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Triage del feedback de la beta (C8-17), solo servidor y solo admins. Dos barreras: ADMIN_EMAILS acá y
 * `app_admins` en la base (`admin_beta_feedback_triage` y `_set_status`, rls/0018). Apagado salvo
 * `FEEDBACK_TRIAGE_ENABLED=1`, después de aplicar la migración 0059.
 */
export function feedbackTriageEnabled(): boolean {
  return process.env.FEEDBACK_TRIAGE_ENABLED === "1";
}

export type TriageResult =
  { ok: true; rows: TriageRow[] } | { ok: false; reason: "no_admin" | "apagado" | "sin_datos" };

type Raw = {
  id: string;
  created_at: Date | string;
  category: string;
  path: string;
  message: string;
  person: string;
  career: string | null;
  status: string;
  actions: unknown;
};

function toActions(raw: unknown): FeedbackAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const o = a as Record<string, unknown>;
    const type = o.type === "navigate" || o.type === "click" ? o.type : null;
    if (!type) return [];
    return [
      {
        type,
        text: typeof o.text === "string" ? o.text.slice(0, 60) : "",
        time: typeof o.time === "string" ? o.time : "",
      },
    ];
  });
}

export async function getFeedbackTriage(userId: string): Promise<TriageResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  if (!feedbackTriageEnabled()) return { ok: false, reason: "apagado" };
  try {
    const raw = (await withUser(userId, (tx) =>
      tx.execute(sql`select * from admin_beta_feedback_triage(500)`),
    )) as unknown as Raw[];
    return {
      ok: true,
      rows: Array.from(raw).map((r) => ({
        id: r.id,
        createdAt: new Date(r.created_at),
        category: r.category,
        path: r.path,
        message: r.message,
        person: r.person,
        career: r.career,
        status: isFeedbackStatus(r.status) ? r.status : "nuevo",
        actions: toActions(r.actions),
      })),
    };
  } catch {
    return { ok: false, reason: "sin_datos" };
  }
}

export async function setFeedbackStatus(
  userId: string,
  id: string,
  status: FeedbackStatus,
): Promise<boolean> {
  if (!(await canCreateInvitations(userId)) || !feedbackTriageEnabled()) return false;
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select admin_beta_feedback_set_status(${id}::uuid, ${status}) as ok`),
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}
