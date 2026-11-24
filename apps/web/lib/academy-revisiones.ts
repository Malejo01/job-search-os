import { sql } from "drizzle-orm";
import { cache } from "react";
import { loadAcademyFichas, onlyApproved, publishedFichas, type AcademyFicha } from "./academy";
import { withUser } from "./db";

/**
 * Revisión de Academy desde la app (R26-01, rls/0065). Solo servidor.
 *
 * Una ficha se publica si su archivo dice `aprobada` o si la base tiene una aprobación vigente con la misma
 * huella que su contenido de hoy (`decidirPublicacion`, en pipeline). Todo falla cerrado: si la consulta
 * rompe (por ejemplo, la función todavía no está aplicada en la base), las fichas siguen como dice su
 * archivo, es decir, en borrador.
 */

/** slug → huella de la aprobación vigente. Cualquier sesión; una consulta por request y persona. */
export const approvedHuellas = cache(async (userId: string): Promise<Map<string, string>> => {
  try {
    const rows = (await withUser(userId, (tx) =>
      tx.execute(sql`select slug, content_hash from academy_approved_list()`),
    )) as unknown as { slug: string; content_hash: string }[];
    return new Map(rows.map((r) => [r.slug, r.content_hash]));
  } catch {
    return new Map();
  }
});

/** Todas las fichas con su estado de publicación de hoy (el archivo o la base). */
export async function loadPublishedFichas(userId: string): Promise<AcademyFicha[]> {
  const fichas = loadAcademyFichas();
  // Sin ninguna en borrador no hace falta preguntarle a la base
  if (fichas.every((f) => f.estado === "aprobada")) return fichas;
  return publishedFichas(fichas, await approvedHuellas(userId));
}

/** Las fichas que se muestran en Academy. */
export async function loadApprovedFichasFor(userId: string): Promise<AcademyFicha[]> {
  return onlyApproved(await loadPublishedFichas(userId));
}

/** Una ficha publicada por su slug; `null` si no existe o sigue en borrador. Pregunta a la base solo si hace falta. */
export async function loadApprovedFichaFor(
  userId: string,
  slug: string,
): Promise<AcademyFicha | null> {
  const ficha = loadAcademyFichas().find((f) => f.slug === slug);
  if (!ficha) return null;
  if (ficha.estado === "aprobada") return ficha;
  const [publicada] = publishedFichas([ficha], await approvedHuellas(userId));
  return publicada && publicada.estado === "aprobada" ? publicada : null;
}

export type ReviewStatus = "aprobada" | "cambios";

export type ReviewRow = {
  slug: string;
  contentHash: string;
  status: ReviewStatus;
  comment: string | null;
  reviewerEmail: string | null;
  createdAt: Date;
};

type RawRow = {
  slug: string;
  content_hash: string;
  status: string;
  comment: string | null;
  reviewer_email: string | null;
  created_at: Date | string;
};

function toRow(r: RawRow): ReviewRow {
  return {
    slug: r.slug,
    contentHash: r.content_hash,
    status: r.status === "aprobada" ? "aprobada" : "cambios",
    comment: r.comment,
    reviewerEmail: r.reviewer_email,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  };
}

/** Lo último que se dijo de cada ficha, por slug. Solo quien revisa (la base lo exige). */
export async function reviewLatestBySlug(userId: string): Promise<Map<string, ReviewRow>> {
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select * from academy_review_latest()`),
  )) as unknown as RawRow[];
  return new Map(rows.map((r) => [r.slug, toRow(r)]));
}

/** El historial de todas las fichas, lo más nuevo primero. Solo quien revisa. */
export async function reviewHistory(userId: string, limit = 100): Promise<ReviewRow[]> {
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select * from academy_review_history(null::text, ${limit}::int)`),
  )) as unknown as RawRow[];
  return rows.map(toRow);
}

export type AddReviewResult = "ok" | "sin_cambio" | "invalido";

/** Agrega una revisión. La base exige admin o tester y valida slug, huella y comentario. */
export async function addReview(
  userId: string,
  input: { slug: string; huella: string; status: ReviewStatus; comment: string | null },
): Promise<AddReviewResult> {
  const rows = (await withUser(userId, (tx) =>
    tx.execute(
      sql`select academy_review_add(${input.slug}::text, ${input.huella}::text, ${input.status}::text, ${input.comment}::text) as r`,
    ),
  )) as unknown as { r: string }[];
  const r = rows[0]?.r;
  return r === "ok" || r === "sin_cambio" ? r : "invalido";
}
