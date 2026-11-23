import { getRoleMarket } from "@job-search-os/adapters";
import { CV_KEYWORDS_TOP, type KeywordMarket } from "@job-search-os/pipeline";
import { unstable_cache } from "next/cache";
import { assertAppRole, getAppDb } from "@/lib/db";
import { getTargetRoles } from "@/lib/onboarding";

/**
 * Mercado del puesto principal para «Palabras clave de tu carrera» (R20-01). El puesto principal es el
 * primero que eligió la persona. La lectura del mercado es una sola por pantalla y va en caché de 30
 * minutos por puesto: la clave NO lleva usuario a propósito, porque el resultado sale solo de
 * `role_market_snapshots` (lectura abierta, sin datos de nadie) y es idéntico para todas las personas.
 * El valor es JSON plano porque el Data Cache lo serializa.
 *
 * Sin puesto elegido o si la lectura falla devuelve `null`: el ítem queda en «Pronto», nunca con un puntaje
 * inventado.
 */
function cachedRoleMarket(role: string): Promise<KeywordMarket> {
  return unstable_cache(
    async (): Promise<KeywordMarket> => {
      await assertAppRole();
      // Sin `withUser`: la policy de `role_market_snapshots` es `USING (true)`.
      const market = await getAppDb().transaction(
        (tx) => getRoleMarket(tx, role, { limit: CV_KEYWORDS_TOP }),
        { accessMode: "read only" },
      );
      return {
        jobs: market.jobs,
        skills: market.skills.map((m) => ({ slug: m.slug, name: m.name, mentions: m.mentions })),
      };
    },
    ["cv-keywords-market", "v1", role],
    { revalidate: 1800, tags: ["cv-keywords-market", `cv-keywords-market:${role}`] },
  )();
}

export async function loadKeywordMarket(userId: string): Promise<KeywordMarket | null> {
  try {
    const role = (await getTargetRoles(userId))[0];
    return role ? await cachedRoleMarket(role) : null;
  } catch {
    return null;
  }
}
