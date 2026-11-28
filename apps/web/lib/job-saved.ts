import { schema as s } from "@job-search-os/db";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/ids";

/**
 * «Guardada» (R30-03): marca con fecha (`jobs.saved_at`), no un estado. Guardar una oferta ya guardada
 * conserva la fecha original. Siempre con la sesión y el `user_id` de la persona (más la RLS de `jobs`):
 * la oferta de otra persona no existe para quien llama.
 */
export type SetSavedResult = { ok: true; saved: boolean } | { ok: false; code: "inexistente" };

export async function setJobSaved(
  userId: string,
  jobId: string,
  saved: boolean,
): Promise<SetSavedResult> {
  if (!isUuid(jobId)) return { ok: false, code: "inexistente" };
  return withUser(userId, async (tx): Promise<SetSavedResult> => {
    const rows = await tx
      .update(s.jobs)
      .set({ savedAt: saved ? sql`coalesce(${s.jobs.savedAt}, now())` : null })
      .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
      .returning({ id: s.jobs.id });
    return rows.length ? { ok: true, saved } : { ok: false, code: "inexistente" };
  });
}
