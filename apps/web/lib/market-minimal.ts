import { readMarketMinimalInput } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { buildMarketMinimal, type MarketMinimal, type RoleKey } from "@job-search-os/pipeline";
import { and, eq, gte } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { assertAppRole, getAppDb, withUser } from "./db";

/**
 * `/market` mínimo (R34-03). El cálculo vive en el pipeline (`buildMarketMinimal`); acá solo la lectura.
 *
 * Dos lecturas, ambas de una transacción de solo lectura:
 * - el pool de la carrera (avisos vigentes y las habilidades que piden): idéntico para todas las personas, así
 *   que va con caché de 30 minutos por carrera y sin usuario en la clave (sale solo de `public_jobs`);
 * - las habilidades que la persona tiene cargadas (`skill_levels`, nivel 1 o más), dentro de `withUser`.
 *
 * Reemplaza las ocho lecturas que hacía la pantalla anterior (agenda, rango de semanas, candidatas, madurez,
 * carreras públicas, mercado del puesto y de la carrera).
 */
const POOL_TAG = "market-minimal";

type PoolInput = Awaited<ReturnType<typeof readMarketMinimalInput>>;

async function readPoolInput(role: RoleKey) {
  await assertAppRole();
  const input = await getAppDb().transaction((tx) => readMarketMinimalInput(tx, role, new Date()), {
    accessMode: "read only",
  });
  return {
    computedAt: new Date().toISOString(),
    jobs: input.jobs.map((j) => ({ ...j, lastSeenAt: j.lastSeenAt.toISOString() })),
    skills: input.skills,
  };
}

/**
 * El pool de la carrera como JSON plano (las fechas en ISO) porque el Data Cache lo serializa. Con
 * `MARKET_POOL_CACHE=off` se lee sin caché: lo usan los e2e (playwright.config), que siembran avisos y miden la
 * pantalla en la misma corrida; con el caché, una visita anterior con el pool vacío se serviría hasta 30 minutos.
 */
function getPoolInput(role: RoleKey) {
  if (process.env.MARKET_POOL_CACHE === "off") return readPoolInput(role);
  return unstable_cache(() => readPoolInput(role), [POOL_TAG, "v1", role], {
    revalidate: 1800,
    tags: [POOL_TAG, `${POOL_TAG}:${role}`],
  })();
}

/** Slugs de las habilidades que la persona tiene cargadas (nivel 1 o más; el 0 es «nunca lo usé»). */
export async function getUserSkillSlugs(userId: string): Promise<string[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({ slug: s.skills.slug })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(and(eq(s.skillLevels.userId, userId), gte(s.skillLevels.level, 1)));
    return rows.map((r) => r.slug);
  });
}

export async function getMarketMinimal(userId: string, role: RoleKey): Promise<MarketMinimal> {
  const [pool, userSkills] = await Promise.all([getPoolInput(role), getUserSkillSlugs(userId)]);
  const jobs: PoolInput["jobs"] = pool.jobs.map((j) => ({
    ...j,
    lastSeenAt: new Date(j.lastSeenAt),
  }));
  return buildMarketMinimal({
    jobs,
    skills: pool.skills,
    userSkills,
    // La fecha del dato es la de la lectura del pool, no la de esta visita (el caché dura 30 minutos)
    now: new Date(pool.computedAt),
  });
}
