import { schema as s } from "@job-search-os/db";
import { unstable_cache } from "next/cache";
import { assertAppRole, getAppDb } from "./db";

/**
 * Catálogo de skills (`skills`), con caché de una hora (C5-7, ahorro de Neon). Es global y casi estático:
 * solo cambia con una migración que suma skills, y se actualiza solo como mucho una hora después. Antes cada
 * visita a «Tus skills», cada guardado y cada cálculo de «Mercado» lo volvía a leer entero (≈110 filas con
 * sus alias y descripciones) dentro de la transacción de la persona.
 *
 * Mismo criterio que `career-market.ts`: sin `withUser`, porque las policies de esta tabla son
 * `USING (true)`, y la clave del caché lleva versión porque el Data Cache de Vercel persiste entre deploys.
 */
export type SkillTaxonomyRow = {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  description: string | null;
  closureHours: number | null;
};

export function getSkillTaxonomy(): Promise<SkillTaxonomyRow[]> {
  return unstable_cache(
    async () => {
      await assertAppRole();
      return getAppDb().transaction(
        (tx) =>
          tx
            .select({
              slug: s.skills.slug,
              name: s.skills.name,
              category: s.skills.category,
              aliases: s.skills.aliases,
              description: s.skills.description,
              closureHours: s.skills.closureHours,
            })
            .from(s.skills)
            .orderBy(s.skills.name),
        { accessMode: "read only" },
      );
    },
    ["skill-taxonomy", "v1"],
    { revalidate: 3600, tags: ["skill-taxonomy"] },
  )();
}
