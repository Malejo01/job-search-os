import { schema as s } from "@job-search-os/db";
import { BETA_PLAN, decidePaymentNotice } from "@job-search-os/pipeline";
import { and, desc, eq, sql } from "drizzle-orm";
import { withUser } from "./db";

/** Avisos «Ya pagué» de la persona (R22-01). Todo con RLS: solo ve y crea los suyos. */
export type OwnPaymentNotice = {
  id: string;
  status: string;
  createdAt: Date;
};

/** Sus avisos más nuevos primero (una consulta; tope chico: nunca hay más de unos pocos abiertos). */
export async function listOwnPaymentNotices(userId: string): Promise<OwnPaymentNotice[]> {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: s.paymentNotices.id,
        status: s.paymentNotices.status,
        createdAt: s.paymentNotices.createdAt,
      })
      .from(s.paymentNotices)
      .where(eq(s.paymentNotices.userId, userId))
      .orderBy(desc(s.paymentNotices.createdAt))
      .limit(10),
  );
}

export type CreatePaymentNoticeResult = { ok: true } | { ok: false; reason: "tope" | "error" };

/** ¿El error es el CHECK del trigger de tope (23514 con su mensaje)? Mira también la causa que envuelve drizzle. */
function isCapError(error: unknown): boolean {
  for (let e: unknown = error, i = 0; e && i < 4; i++, e = (e as { cause?: unknown }).cause) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (
      code === "23514" &&
      typeof message === "string" &&
      message.includes("payment_notices: tope")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Crea un aviso pendiente. El conteo y el alta van en la misma transacción para el mensaje claro; la barrera
 * contra la carrera (dos envíos a la vez) es el trigger de la base (rls/0053), que serializa por persona: si
 * salta, es el mismo «tope». Cualquier otro fallo se informa como `error` (nunca crea de más).
 */
export async function createPaymentNotice(
  userId: string,
  operationNumber: string | null,
): Promise<CreatePaymentNoticeResult> {
  try {
    return await withUser(userId, async (tx): Promise<CreatePaymentNoticeResult> => {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.paymentNotices)
        .where(and(eq(s.paymentNotices.userId, userId), eq(s.paymentNotices.status, "pendiente")));
      if (!decidePaymentNotice(row?.n ?? Number.NaN).ok) return { ok: false, reason: "tope" };
      await tx
        .insert(s.paymentNotices)
        .values({ userId, plan: BETA_PLAN, operationNumber, status: "pendiente" });
      return { ok: true };
    });
  } catch (error) {
    return { ok: false, reason: isCapError(error) ? "tope" : "error" };
  }
}
