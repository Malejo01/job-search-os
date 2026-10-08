import { schema as s } from "@job-search-os/db";
import { criteriaFromOnboarding, type CriteriaRules } from "@job-search-os/pipeline";
import { and, desc, eq, sql } from "drizzle-orm";
import { withUser, type Tx } from "./db";

/**
 * Criterios editables (JS-096). La lectura de la ingesta toma la activa de mayor versión
 * (`active = true order by version desc limit 1`); acá cada guardado deja exactamente una activa.
 */

export type ActiveCriteria = { version: number; rules: CriteriaRules; createdAt: Date };

export type SaveCriteriaResult = { ok: true; version: number } | { ok: false; reason: "conflict" };

/** Se lanza dentro de la transacción para deshacerla entera cuando otro guardado ganó. */
class SaveConflict extends Error {}

export async function getActiveCriteria(userId: string): Promise<ActiveCriteria | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({
        version: s.evaluationCriteria.version,
        rules: s.evaluationCriteria.rules,
        createdAt: s.evaluationCriteria.createdAt,
      })
      .from(s.evaluationCriteria)
      .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)))
      .orderBy(desc(s.evaluationCriteria.version))
      .limit(1);
    return row
      ? { version: row.version, rules: row.rules as CriteriaRules, createdAt: row.createdAt }
      : null;
  });
}

/**
 * Desactiva las versiones activas del usuario e inserta la siguiente como única activa. Si
 * `baseVersion` viene y ya no es la última, o el unique (user_id, version) frena el insert
 * (doble envío), lanza SaveConflict: la transacción se deshace y no queda nada a medias.
 */
async function writeNextVersion(
  tx: Tx,
  userId: string,
  rules: CriteriaRules,
  baseVersion: number | undefined,
): Promise<number> {
  const [latest] = await tx
    .select({ maxVersion: sql<number>`coalesce(max(${s.evaluationCriteria.version}), 0)::int` })
    .from(s.evaluationCriteria)
    .where(eq(s.evaluationCriteria.userId, userId));
  const maxVersion = latest?.maxVersion ?? 0;
  if (baseVersion !== undefined && baseVersion !== maxVersion) throw new SaveConflict();

  await tx
    .update(s.evaluationCriteria)
    .set({ active: false })
    .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)));
  const inserted = await tx
    .insert(s.evaluationCriteria)
    .values({ userId, version: maxVersion + 1, active: true, rules })
    .onConflictDoNothing()
    .returning({ version: s.evaluationCriteria.version });
  if (inserted.length === 0) throw new SaveConflict();
  return maxVersion + 1;
}

async function runSave(
  userId: string,
  build: (tx: Tx) => Promise<CriteriaRules>,
  baseVersion: number | undefined,
): Promise<SaveCriteriaResult> {
  try {
    const version = await withUser(userId, async (tx) =>
      writeNextVersion(tx, userId, await build(tx), baseVersion),
    );
    return { ok: true, version };
  } catch (error) {
    if (error instanceof SaveConflict) return { ok: false, reason: "conflict" };
    throw error;
  }
}

/** Guarda `rules` como la versión N+1 activa. `baseVersion` es la que el usuario estaba viendo. */
export async function saveCriteria(
  userId: string,
  rules: CriteriaRules,
  baseVersion?: number,
): Promise<SaveCriteriaResult> {
  return runSave(userId, async () => rules, baseVersion);
}

/** Vuelve a las reglas por defecto, conservando el piso salarial y las horas del perfil. */
export async function resetCriteriaToDefaults(
  userId: string,
  baseVersion?: number,
): Promise<SaveCriteriaResult> {
  return runSave(
    userId,
    async (tx) => {
      const [profile] = await tx
        .select({
          salaryFloorUsd: s.profiles.salaryFloorUsd,
          maxWeeklyHours: s.profiles.maxWeeklyHours,
        })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .limit(1);
      return criteriaFromOnboarding({
        salaryFloorUsd: profile?.salaryFloorUsd ?? null,
        maxWeeklyHours: profile?.maxWeeklyHours ?? null,
      });
    },
    baseVersion,
  );
}
