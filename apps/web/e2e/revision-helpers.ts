import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as s from "@job-search-os/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { E2E_B_USER_ID, ensureSecondUser, ownerDb } from "./helpers";

/**
 * Apoyo de los flujos 230-234 (R26-01 y R26-02): revisión de Academy y de los textos del rediseño desde la
 * app. Todo con la persona B (la base local no tiene usuario seed). El servidor de e2e lee las fichas de
 * `e2e/fixtures/academy` (ACADEMY_DIR, playwright.config.ts): dos fichas inventadas, en borrador. Nada llama
 * a un modelo.
 */

export const FICHAS_DIR = join(__dirname, "fixtures", "academy");

/** Fichas de prueba (nombre de archivo = slug) y el título que muestran. */
export const FICHA_STAR = { slug: "metodo-star", titulo: "Ficha de prueba STAR" };
export const FICHA_SENIORITY = { slug: "seniority", titulo: "Ficha de prueba seniority" };

/** B con el rol `tester` en la base (los revisores se barren por `user_roles` o `app_admins`). */
export async function makeBTester(): Promise<void> {
  await ensureSecondUser();
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.userRoles)
      .values({ userId: E2E_B_USER_ID, role: "tester" })
      .onConflictDoNothing();
  } finally {
    await close();
  }
}

/** B sin rol en la base: sigue siendo tester por `ASSISTANT_TESTER_EMAILS` (la app la deja entrar, la base no). */
export async function removeBTesterRole(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.userRoles)
      .where(and(eq(s.userRoles.userId, E2E_B_USER_ID), eq(s.userRoles.role, "tester")));
  } finally {
    await close();
  }
}

/** Borra las revisiones de las fichas de prueba (cada spec parte limpio y deja limpio). */
export async function clearAcademyReviews(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.academyReviews)
      .where(inArray(s.academyReviews.slug, [FICHA_STAR.slug, FICHA_SENIORITY.slug]));
  } finally {
    await close();
  }
}

/** Revisiones guardadas de una ficha, la más nueva primero (estado y comentario). */
export async function academyReviewsOf(
  slug: string,
): Promise<{ status: string; comment: string | null }[]> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({
        status: s.academyReviews.status,
        comment: s.academyReviews.comment,
        createdAt: s.academyReviews.createdAt,
      })
      .from(s.academyReviews)
      .where(eq(s.academyReviews.slug, slug))
      .orderBy(s.academyReviews.createdAt);
    return rows.reverse().map(({ status, comment }) => ({ status, comment }));
  } finally {
    await close();
  }
}

/** Claves de textos del rediseño que usan los flujos 233 y 234 (`apps/web/lib/textos-rediseno.ts`). */
export const TEXTO_ALTO = "AFFINITY_WORDS.high";
export const TEXTO_MEDIO = "AFFINITY_WORDS.mid";

/** Borra las revisiones de los textos que usan los flujos (cada spec parte limpio y deja limpio). */
export async function clearTextReviews(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.textReviews).where(inArray(s.textReviews.textKey, [TEXTO_ALTO, TEXTO_MEDIO]));
  } finally {
    await close();
  }
}

/** Revisiones guardadas de un texto, la más nueva primero (estado y propuesta). */
export async function textReviewsOf(
  key: string,
): Promise<{ status: string; proposal: string | null }[]> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({
        status: s.textReviews.status,
        proposal: s.textReviews.proposal,
        createdAt: s.textReviews.createdAt,
      })
      .from(s.textReviews)
      .where(eq(s.textReviews.textKey, key))
      .orderBy(s.textReviews.createdAt);
    return rows.reverse().map(({ status, proposal }) => ({ status, proposal }));
  } finally {
    await close();
  }
}

/**
 * Cambia el cuerpo de una ficha de prueba y devuelve una función que deja el archivo como estaba. El servidor lee
 * el disco en cada pedido (las páginas son dinámicas): el cambio se ve sin reiniciarlo.
 */
export function editFicha(slug: string, extra: string): () => void {
  const file = join(FICHAS_DIR, `${slug}.md`);
  const original = readFileSync(file, "utf8");
  writeFileSync(file, `${original.trimEnd()}\n\n${extra}\n`);
  return () => writeFileSync(file, original);
}
