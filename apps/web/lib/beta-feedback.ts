import { schema as s } from "@job-search-os/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";
import { isOverDailyLimit, type FeedbackInput } from "@job-search-os/pipeline";

/**
 * «Contanos qué pasó» (C-23), solo servidor. El envío corre en una transacción de la persona
 * (RLS: solo inserta con su user_id) y cuenta ahí mismo sus envíos de las últimas 24 h; un lock
 * por persona evita que dos envíos a la vez pasen el tope.
 */
export async function saveFeedback(
  userId: string,
  input: FeedbackInput,
): Promise<{ ok: true } | { ok: false; field: "limit" }> {
  return withUser(userId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 23))`);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.betaFeedback)
      .where(
        and(
          eq(s.betaFeedback.userId, userId),
          gt(s.betaFeedback.createdAt, sql`now() - interval '24 hours'`),
        ),
      );
    if (isOverDailyLimit(row?.n ?? 0)) return { ok: false as const, field: "limit" as const };
    await tx.insert(s.betaFeedback).values({ userId, ...input });
    return { ok: true as const };
  });
}

export type FeedbackRow = {
  createdAt: Date;
  category: string;
  path: string;
  message: string;
  /** 6 caracteres del sha256 del user_id: identificador seudónimo, sin email ni nombre. */
  person: string;
};

export type FeedbackListResult =
  { ok: true; rows: FeedbackRow[] } | { ok: false; reason: "no_admin" | "sin_datos" };

/**
 * Las últimas 50 para el admin, por `admin_beta_feedback()` (rls/0013). Mismas dos barreras que las
 * métricas: ADMIN_EMAILS acá y `app_admins` en la base. Si la función todavía no está aplicada en la
 * base, vuelve `sin_datos`.
 */
export async function getBetaFeedback(userId: string): Promise<FeedbackListResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const raw = (await withUser(userId, (tx) =>
      tx.execute(
        sql`select created_at, category, path, message, person from admin_beta_feedback()`,
      ),
    )) as unknown as {
      created_at: Date | string;
      category: string;
      path: string;
      message: string;
      person: string;
    }[];
    return {
      ok: true,
      rows: Array.from(raw).map((r) => ({
        createdAt: new Date(r.created_at),
        category: r.category,
        path: r.path,
        message: r.message,
        person: r.person,
      })),
    };
  } catch {
    return { ok: false, reason: "sin_datos" };
  }
}
