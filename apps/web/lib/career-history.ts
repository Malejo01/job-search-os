import { schema as s } from "@job-search-os/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { withUser } from "./db";
import { HISTORY_MAX_ENTRIES, type HistoryInput } from "./career-history-core";

/**
 * Historial del CV (C-25, CVC-2), solo servidor. Todo dentro de `withUser`: la RLS (rls/0014) deja
 * leer y escribir solo las filas de la persona, y además cada consulta filtra por su id.
 */
export type HistoryRow = HistoryInput & { id: string; source: string };

export async function listCareerHistory(userId: string): Promise<HistoryRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(s.careerHistory)
      .where(eq(s.careerHistory.userId, userId))
      .orderBy(asc(s.careerHistory.sort), asc(s.careerHistory.createdAt));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as HistoryInput["kind"],
      organization: r.organization,
      title: r.title,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      bullets: r.bullets,
      source: r.source,
    }));
  });
}

/** Alta con tope de 20 entradas por persona; un lock evita que dos altas a la vez lo pasen. */
export async function addCareerHistory(
  userId: string,
  input: HistoryInput,
): Promise<{ ok: true } | { ok: false; field: "limit" }> {
  return withUser(userId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 25))`);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int`, top: sql<number>`coalesce(max(sort), -1)::int` })
      .from(s.careerHistory)
      .where(eq(s.careerHistory.userId, userId));
    if ((row?.n ?? 0) >= HISTORY_MAX_ENTRIES)
      return { ok: false as const, field: "limit" as const };
    await tx
      .insert(s.careerHistory)
      .values({ userId, ...input, source: "manual", sort: (row?.top ?? -1) + 1 });
    return { ok: true as const };
  });
}

/** `false` si la fila no existe o no es de la persona (la RLS la deja afuera). */
export async function updateCareerHistory(
  userId: string,
  id: string,
  input: HistoryInput,
): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .update(s.careerHistory)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(s.careerHistory.id, id), eq(s.careerHistory.userId, userId)))
      .returning({ id: s.careerHistory.id });
    return rows.length === 1;
  });
}

export async function deleteCareerHistory(userId: string, id: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .delete(s.careerHistory)
      .where(and(eq(s.careerHistory.id, id), eq(s.careerHistory.userId, userId)))
      .returning({ id: s.careerHistory.id });
    return rows.length === 1;
  });
}
