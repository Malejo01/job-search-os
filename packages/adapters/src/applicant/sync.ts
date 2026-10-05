import { schema as s, type Db } from "@job-search-os/db";
import { planFactsSync, type ApplicantFile, type FactsSyncPlan } from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";

/**
 * Carga el archivo del candidato (hechos y respuestas fijas) en la base (JS-053). Solo toca
 * candidate_facts y application_settings de ese usuario; nada de perfil ni golden (eso es
 * db:seed, que en producción no se corre). Los hechos que salen del archivo se desactivan.
 */
export type ApplicantSyncResult = {
  facts: FactsSyncPlan;
  settings: { changed: string[]; created: boolean };
  applied: boolean;
};

const SETTINGS_FIELDS = ["availability", "contract", "workAuthorization", "links"] as const;

// jsonb no conserva el orden de las claves: comparar con las claves ordenadas
const canonical = (v: unknown): string =>
  JSON.stringify(v ?? null, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

export async function syncApplicant(
  db: Db,
  input: { userId: string; file: ApplicantFile; apply: boolean; now?: () => Date },
): Promise<ApplicantSyncResult> {
  const { userId, file } = input;
  const now = input.now?.() ?? new Date();
  return db.transaction(async (tx) => {
    // Mismo camino que la app: RLS con el usuario fijado, sea cual sea el rol conectado
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);

    const current = await tx
      .select({
        key: s.candidateFacts.key,
        project: s.candidateFacts.project,
        claim: s.candidateFacts.claim,
        metric: s.candidateFacts.metric,
        source: s.candidateFacts.source,
        verification: s.candidateFacts.verification,
        sort: s.candidateFacts.sort,
        active: s.candidateFacts.active,
      })
      .from(s.candidateFacts)
      .where(eq(s.candidateFacts.userId, userId));
    const facts = planFactsSync(current as never, file.facts);

    const [existing] = await tx
      .select()
      .from(s.applicationSettings)
      .where(eq(s.applicationSettings.userId, userId));
    const changed = SETTINGS_FIELDS.filter(
      (f) => canonical(existing?.[f]) !== canonical(file.settings[f]),
    );
    const settings = { changed: existing ? changed : [...SETTINGS_FIELDS], created: !existing };

    if (!input.apply) return { facts, settings, applied: false };

    for (const f of facts.insert) {
      await tx.insert(s.candidateFacts).values({ userId, ...f, createdAt: now, updatedAt: now });
    }
    for (const u of facts.update) {
      const { key, ...rest } = u.fact;
      await tx
        .update(s.candidateFacts)
        .set({ ...rest, active: true, updatedAt: now })
        .where(sql`${s.candidateFacts.userId} = ${userId} and ${s.candidateFacts.key} = ${key}`);
    }
    for (const key of facts.deactivate) {
      await tx
        .update(s.candidateFacts)
        .set({ active: false, updatedAt: now })
        .where(sql`${s.candidateFacts.userId} = ${userId} and ${s.candidateFacts.key} = ${key}`);
    }
    if (settings.changed.length) {
      const values = { ...file.settings, updatedAt: now };
      await tx
        .insert(s.applicationSettings)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: s.applicationSettings.userId, set: values });
    }
    return { facts, settings, applied: true };
  });
}
