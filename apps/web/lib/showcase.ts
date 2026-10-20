import { readPoolShowcaseInput, readShowcaseJobs } from "@job-search-os/adapters";
import { resolveDatabaseUrl } from "@job-search-os/db";
import {
  ROLE_KEYS,
  SHOWCASE_SOURCES,
  buildPoolShowcase,
  pickShowcaseJobs,
  type PoolShowcase,
  type RoleKey,
  type ShowcaseCard,
} from "@job-search-os/pipeline";
import { assertAppRole, getAppDb, type Tx } from "./db";

/**
 * Lecturas de la vitrina pública (ronda 63): portada, /mercado y /ofertas. Solo `public_jobs` y sus
 * skills, sin usuario: nada de `withUser`. Las páginas son ISR (`revalidate`), así que acá no hay
 * `unstable_cache`: cada página se calcula una vez por hora, no por visita.
 */

/** Tarjetas por página de /ofertas. */
export const SHOWCASE_PAGE_SIZE = 20;

/** `/mercado/[carrera]` y `/ofertas/[carrera]`: solo claves de `ROLE_KEYS`; si no, null. */
export function careerFromSlug(slug: string): RoleKey | null {
  return ROLE_KEYS.find((k) => k === slug) ?? null;
}

/**
 * Lectura de solo lectura sobre el pool público. Devuelve `null` únicamente cuando la app no tiene
 * URL de base configurada (el build del CI): ahí la página muestra "Datos en preparación" en vez de
 * romper el prerender. Cualquier otro error se propaga, para que ISR siga sirviendo la versión
 * anterior en vez de cachear una página vacía.
 */
export async function readPublicPool<T>(read: (tx: Tx) => Promise<T>): Promise<T | null> {
  if (!resolveDatabaseUrl({ purpose: "app" })) return null;
  await assertAppRole();
  return getAppDb().transaction(read, { accessMode: "read only" });
}

export function getPoolShowcase(): Promise<PoolShowcase | null> {
  return readPublicPool(async (tx) =>
    buildPoolShowcase(await readPoolShowcaseInput(tx, new Date(), SHOWCASE_SOURCES)),
  );
}

export function getShowcaseCards(role?: RoleKey): Promise<ShowcaseCard[] | null> {
  return readPublicPool(async (tx) =>
    pickShowcaseJobs(
      await readShowcaseJobs(
        tx,
        { role, limit: SHOWCASE_PAGE_SIZE, sources: SHOWCASE_SOURCES },
        new Date(),
      ),
      SHOWCASE_PAGE_SIZE,
    ),
  );
}
