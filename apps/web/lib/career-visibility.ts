import { readCareerRevealCounts } from "@job-search-os/adapters";
import { resolveDatabaseUrl, type Db } from "@job-search-os/db";
import {
  PUBLIC_THRESHOLD_ROLE_KEYS,
  publicCareerKeys,
  type CareerRevealCount,
  type RoleKey,
} from "@job-search-os/pipeline";
import { unstable_cache } from "next/cache";
import { EMPTY_PAGE_REVALIDATE_SECONDS, readPublicPool } from "./showcase";

/**
 * Qué carreras se muestran en las páginas públicas (ADR-029): chips, sitemap, «Datos curiosos» de /mercado y
 * el selector de «Mercado» dentro de la app. La regla es pura (`publicCareerKeys`, en el pipeline); acá
 * solo está la lectura y el caché.
 *
 * - **Un solo conteo cada hora para todo el sitio.** `unstable_cache` con `revalidate` de 1 hora, sin
 *   usuario en la clave: todas las páginas (ISR de 1 hora) comparten la misma lectura, así que no suma
 *   consultas a Neon. Peor caso entre que una carrera llega a 10 ofertas y que se vea: unas 2 horas
 *   (el caché de este conteo más el ISR de la página).
 * - **Falla cerrado.** Sin URL de base o con la base caída, las carreras sujetas al umbral se ocultan; las
 *   demás siguen (no dependen de la base). Un fallo no se cachea una hora: la página queda con la vida
 *   corta de `EMPTY_PAGE_REVALIDATE_SECONDS` y se vuelve a intentar.
 * - No lo usan el onboarding, el perfil ni `/acceso`: esos ofrecen siempre `BETA_ROLE_KEYS` (C5-1).
 */

const COUNTS_REVALIDATE_SECONDS = 3600;

/** Las ofertas por carrera sujeta al umbral. Si la base falla, lanza: Next no cachea una excepción. */
const cachedCounts = unstable_cache(
  async (): Promise<CareerRevealCount[]> => {
    const counts = await readPublicPool((tx) =>
      readCareerRevealCounts(tx as unknown as Db, PUBLIC_THRESHOLD_ROLE_KEYS, new Date()),
    );
    if (counts === null) throw new Error("sin base");
    return counts;
  },
  // Sin datos de nadie: sale solo de `public_jobs`. v1: al cambiar la forma se sube la clave (el Data Cache persiste)
  ["career-visibility", "v1"],
  { revalidate: COUNTS_REVALIDATE_SECONDS, tags: ["career-visibility"] },
);

/** Acorta la vida de la página que se está generando: un conteo fallido no se queda una hora. */
function shortenPageLife(): Promise<null> {
  return unstable_cache(async () => null, ["career-visibility-cerrada"], {
    revalidate: EMPTY_PAGE_REVALIDATE_SECONDS,
  })();
}

async function readCounts(): Promise<CareerRevealCount[] | null> {
  if (!resolveDatabaseUrl({ purpose: "app" })) {
    await shortenPageLife();
    return null;
  }
  try {
    return await cachedCounts();
  } catch {
    await shortenPageLife();
    return null;
  }
}

/** Las carreras que se muestran hoy en público, en el orden de `ROLE_KEYS`. */
export async function getPublicCareerKeys(): Promise<readonly RoleKey[]> {
  return publicCareerKeys(await readCounts());
}
