import { schema as s } from "@job-search-os/db";
import { jobCardAllowed, jobCardMode, type RequirementAnswer } from "@job-search-os/pipeline";
import { and, count, eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { getSessionEmail } from "@/lib/profile-agent/access";
import { testerEnvFor } from "@/lib/user-roles";

/**
 * Respuestas de un toque a lo que pide el aviso (R31-05, tabla `requirement_answers`, rls/0072). Una
 * respuesta por persona y clave (`requirementKey` del pipeline): vale para todas las ofertas que pidan
 * lo mismo. Siempre con la sesión y el `user_id` de la persona, más la RLS de la tabla. Sin modelo.
 */

/** Tope de respuestas por persona: un cliente que repite claves distintas no llena la tabla. */
export const REQUIREMENT_ANSWERS_MAX = 300;

/** ¿Esta persona tiene la ficha encendida (`JOB_CARD`)? Apagada o con error: no (falla cerrado). */
export async function requirementAnswersAllowedFor(userId: string): Promise<boolean> {
  if (jobCardMode(process.env) === "off") return false;
  try {
    const email = await getSessionEmail(userId);
    return jobCardAllowed(await testerEnvFor(userId, email), email);
  } catch {
    return false;
  }
}

/** Las respuestas de la persona, por clave. Una sola consulta. */
export async function loadRequirementAnswers(
  userId: string,
): Promise<Map<string, RequirementAnswer>> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        key: s.requirementAnswers.reqKey,
        answer: s.requirementAnswers.answer,
        note: s.requirementAnswers.note,
      })
      .from(s.requirementAnswers)
      .where(eq(s.requirementAnswers.userId, userId)),
  );
  const out = new Map<string, RequirementAnswer>();
  for (const r of rows) {
    if (r.answer === "si" || r.answer === "no" || r.answer === "en_parte") {
      out.set(r.key, { valor: r.answer, nota: r.note });
    }
  }
  return out;
}

export type SaveAnswerResult = { ok: true } | { ok: false; code: "tope" };

/** Guarda o reemplaza la respuesta de la persona a esa clave. La entrada ya viene validada. */
export async function saveRequirementAnswer(
  userId: string,
  input: { clave: string; valor: "si" | "no" | "en_parte"; nota: string | null },
): Promise<SaveAnswerResult> {
  return withUser(userId, async (tx): Promise<SaveAnswerResult> => {
    const [existing] = await tx
      .select({ id: s.requirementAnswers.id })
      .from(s.requirementAnswers)
      .where(
        and(eq(s.requirementAnswers.userId, userId), eq(s.requirementAnswers.reqKey, input.clave)),
      );
    if (!existing) {
      const [n] = await tx
        .select({ n: count() })
        .from(s.requirementAnswers)
        .where(eq(s.requirementAnswers.userId, userId));
      if ((n?.n ?? 0) >= REQUIREMENT_ANSWERS_MAX) return { ok: false, code: "tope" };
    }
    await tx
      .insert(s.requirementAnswers)
      .values({ userId, reqKey: input.clave, answer: input.valor, note: input.nota })
      .onConflictDoUpdate({
        target: [s.requirementAnswers.userId, s.requirementAnswers.reqKey],
        set: { answer: input.valor, note: input.nota, updatedAt: sql`now()` },
      });
    return { ok: true };
  });
}
