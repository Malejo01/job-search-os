import type { RevisionDeTexto } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Revisión de los textos del rediseño desde la app (R26-02, rls/0066). Solo servidor. Todo es para quien revisa
 * (admins y testers): la base lo exige con `can_review_content()`. Una propuesta nunca cambia la app.
 */

export type TextReview = RevisionDeTexto & {
  clave: string;
  proposal: string | null;
  reviewerEmail: string | null;
  createdAt: Date;
};

type RawRow = {
  text_key: string;
  default_hash: string;
  status: string;
  proposal: string | null;
  reviewer_email: string | null;
  created_at: Date | string;
};

function toReview(r: RawRow): TextReview {
  return {
    clave: r.text_key,
    huella: r.default_hash,
    estado: r.status === "aprobada" ? "aprobada" : "propuesta",
    proposal: r.proposal,
    reviewerEmail: r.reviewer_email,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  };
}

/** Lo último que se dijo de cada texto, por clave. Falla (tira) si la persona no revisa. */
export async function textReviewLatest(userId: string): Promise<Map<string, TextReview>> {
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select * from text_review_latest()`),
  )) as unknown as RawRow[];
  return new Map(rows.map((r) => [r.text_key, toReview(r)]));
}

/** El historial de todos los textos, lo más nuevo primero. */
export async function textReviewHistory(userId: string, limit = 100): Promise<TextReview[]> {
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select * from text_review_history(null::text, ${limit}::int)`),
  )) as unknown as RawRow[];
  return rows.map(toReview);
}

export type AddTextReviewResult = "ok" | "sin_cambio" | "invalido";

/** Agrega una revisión. La base exige admin o tester y valida clave, huella y propuesta. */
export async function addTextReview(
  userId: string,
  input: {
    clave: string;
    huella: string;
    estado: "aprobada" | "propuesta";
    proposal: string | null;
  },
): Promise<AddTextReviewResult> {
  const rows = (await withUser(userId, (tx) =>
    tx.execute(
      sql`select text_review_add(${input.clave}::text, ${input.huella}::text, ${input.estado}::text, ${input.proposal}::text) as r`,
    ),
  )) as unknown as { r: string }[];
  const r = rows[0]?.r;
  return r === "ok" || r === "sin_cambio" ? r : "invalido";
}
