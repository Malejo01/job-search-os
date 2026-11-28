import { schema as s } from "@job-search-os/db";
import { CvTailorOutputSchema, type CvTailorOutput } from "@job-search-os/pipeline";
import { and, desc, eq } from "drizzle-orm";
import { withUser } from "@/lib/db";

/**
 * Versión del CV adaptada a una oferta (R34-02, tabla `cv_offer_versions`, rls/0076). Guarda solo la propuesta
 * ya decidida por la persona (qué viñetas van y en qué orden), no un CV: el CV base no se pisa, y cada vez que se
 * lee se vuelve a verificar contra el CV de hoy (`applyCvTailorProposal`). Siempre con la sesión y el `user_id`
 * de la persona más la RLS. Hasta 3 versiones por oferta (decisión del 27/11): al guardar la cuarta, el trigger de
 * rls/0077 borra la más vieja en la misma transacción y acá se avisa. Se usa siempre la más nueva. Sin modelo.
 */

/** Coincide con el CHECK de la tabla. */
export const CV_OFFER_VERSION_MAX_BYTES = 60_000;
/** Coincide con el trigger de rls/0077. */
export const CV_OFFER_VERSIONS_PER_JOB = 3;

export type SavedOfferVersion = { ok: true; replacedOldest: boolean } | { ok: false };

export async function saveOfferVersion(
  userId: string,
  jobId: string,
  proposal: CvTailorOutput,
  now: Date = new Date(),
): Promise<SavedOfferVersion> {
  if (new TextEncoder().encode(JSON.stringify(proposal)).byteLength > CV_OFFER_VERSION_MAX_BYTES) {
    return { ok: false };
  }
  const before = await withUser(userId, async (tx) => {
    const rows = await tx
      .select({ id: s.cvOfferVersions.id })
      .from(s.cvOfferVersions)
      .where(and(eq(s.cvOfferVersions.userId, userId), eq(s.cvOfferVersions.jobId, jobId)));
    await tx
      .insert(s.cvOfferVersions)
      .values({ userId, jobId, proposal, createdAt: now, updatedAt: now });
    return rows.length;
  });
  return { ok: true, replacedOldest: before >= CV_OFFER_VERSIONS_PER_JOB };
}

/** La propuesta más nueva para esta oferta, o `null` si no hay o no cumple el esquema (entrada no confiable). */
export async function loadOfferVersion(
  userId: string,
  jobId: string,
): Promise<{ proposal: CvTailorOutput; updatedAt: Date } | null> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ proposal: s.cvOfferVersions.proposal, updatedAt: s.cvOfferVersions.updatedAt })
      .from(s.cvOfferVersions)
      .where(and(eq(s.cvOfferVersions.userId, userId), eq(s.cvOfferVersions.jobId, jobId)))
      .orderBy(desc(s.cvOfferVersions.createdAt), desc(s.cvOfferVersions.id))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = CvTailorOutputSchema.safeParse(row.proposal);
  return parsed.success ? { proposal: parsed.data, updatedAt: row.updatedAt } : null;
}

/** ¿La oferta es de la persona? RLS más filtro por `user_id`. */
export async function offerBelongsTo(userId: string, jobId: string): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ id: s.jobs.id })
      .from(s.jobs)
      .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
      .limit(1),
  );
  return rows.length > 0;
}

/** ¿Hay una versión guardada? Ante cualquier error (por ejemplo, tabla sin migrar), no. */
export async function hasOfferVersion(userId: string, jobId: string): Promise<boolean> {
  return (await loadOfferVersion(userId, jobId).catch(() => null)) !== null;
}
