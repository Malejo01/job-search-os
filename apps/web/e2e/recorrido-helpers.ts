import * as s from "@job-search-os/db/schema";
import { desc, eq } from "drizzle-orm";
import { E2E_B_USER_ID, ownerDb } from "./helpers";

/**
 * Apoyo de los flujos 235-239 (R26-03 y R26-04): recorrido para revisar y feedback por pantalla. La persona que
 * revisa es la B (tester por `ASSISTANT_TESTER_EMAILS`, playwright.config.ts) y la administradora es la persona
 * de prueba (`ensureSeedPerson`, con `ADMIN_EMAILS` en el servidor). Todo con datos inventados.
 */

/** Cantidad de pantallas de `lib/recorrido.ts`; si se suma o se saca una, este número y el de los specs cambian. */
export const TOTAL_PANTALLAS = 18;

/** Un uuid de mentira para probar que la ruta guardada nunca lleva un id. */
export const UUID_FICTICIO = "3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c";

export type FeedbackRowOf = {
  category: string;
  path: string;
  message: string;
  context: { pathname?: string; pageTitle?: string } | null;
};

/** Los comentarios de una persona, el más nuevo primero. */
export async function feedbackOf(userId: string): Promise<FeedbackRowOf[]> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({
        category: s.betaFeedback.category,
        path: s.betaFeedback.path,
        message: s.betaFeedback.message,
        context: s.betaFeedback.context,
      })
      .from(s.betaFeedback)
      .where(eq(s.betaFeedback.userId, userId))
      .orderBy(desc(s.betaFeedback.createdAt));
    return rows as FeedbackRowOf[];
  } finally {
    await close();
  }
}

/** Borra los comentarios de una persona (cada spec parte limpio y deja limpio). */
export async function clearFeedbackOf(userId: string = E2E_B_USER_ID): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.betaFeedback).where(eq(s.betaFeedback.userId, userId));
  } finally {
    await close();
  }
}

/** Siembra comentarios de B con la ruta tal como se guardaba antes de normalizar (con id). */
export async function seedFeedbackRows(
  rows: { path: string; message: string; category?: string; status?: string }[],
): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.betaFeedback).values(
      rows.map((r) => ({
        userId: E2E_B_USER_ID,
        category: r.category ?? "idea",
        path: r.path,
        message: r.message,
        status: r.status ?? "nuevo",
      })),
    );
  } finally {
    await close();
  }
}
