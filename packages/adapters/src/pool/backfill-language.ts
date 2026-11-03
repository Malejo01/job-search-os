import { schema as s, type Db } from "@job-search-os/db";
import { jobLanguageFacts } from "@job-search-os/pipeline";
import { asc, eq, isNull, sql } from "drizzle-orm";

/**
 * Relleno idempotente del idioma y el nivel de inglés de `public_jobs` (C8-15, migración 0058): calcula
 * `jobLanguageFacts` para las filas con `language_checked_at` null, por tandas. Volver a correrlo no
 * cambia nada de lo ya calculado. Sin `apply` solo cuenta. Lee el texto acotado a 30.000 caracteres,
 * como el mercado por carrera.
 */
export type LanguageBackfillReport = { pending: number; written: number; batches: number };

const JD_MAX_CHARS = 30000;

export async function backfillJobLanguage(
  db: Db,
  opts: { apply: boolean; batch?: number; maxBatches?: number; now?: Date },
): Promise<LanguageBackfillReport> {
  const batch = Math.min(Math.max(opts.batch ?? 200, 1), 1000);
  const maxBatches = opts.maxBatches ?? 1000;
  const [{ n: pending } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.publicJobs)
    .where(isNull(s.publicJobs.languageCheckedAt));
  if (!opts.apply) return { pending, written: 0, batches: 0 };

  let written = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const rows = await db
      .select({
        id: s.publicJobs.id,
        lang: s.publicJobs.lang,
        jdText: sql<string | null>`left(${s.publicJobs.jdText}, ${JD_MAX_CHARS})`,
      })
      .from(s.publicJobs)
      .where(isNull(s.publicJobs.languageCheckedAt))
      .orderBy(asc(s.publicJobs.id))
      .limit(batch);
    if (rows.length === 0) break;
    const at = opts.now ?? new Date();
    await db.transaction(async (tx) => {
      for (const r of rows) {
        const f = jobLanguageFacts(r.jdText, r.lang);
        await tx
          .update(s.publicJobs)
          .set({
            jdLanguage: f.jdLanguage,
            englishLanguage: f.englishLanguage,
            englishAsks: f.englishAsks,
            englishLevel: f.englishLevel,
            languageCheckedAt: at,
          })
          .where(eq(s.publicJobs.id, r.id));
      }
    });
    written += rows.length;
    batches++;
  }
  return { pending, written, batches };
}
