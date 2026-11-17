import { readBetaPoolCounts, type BetaPoolCounts } from "@job-search-os/adapters";
import { BETA_LAUNCH_ROLE_KEYS, SHOWCASE_SOURCES } from "@job-search-os/pipeline";
import { readPublicPool } from "./showcase";

/**
 * Número de la portada (R11-10): ofertas activas de las 8 carreras de la beta y cuántas están en
 * español. Una consulta agregada sobre `public_jobs` (sin usuario, solo lectura); nunca un número
 * fijo. `null` si la app no tiene base configurada (el build del CI): la portada dice «datos en
 * preparación». La página es ISR, así que se calcula una vez por hora, no por visita.
 */
export function getBetaPoolCounts(): Promise<BetaPoolCounts | null> {
  return readPublicPool((tx) =>
    readBetaPoolCounts(tx, new Date(), SHOWCASE_SOURCES, BETA_LAUNCH_ROLE_KEYS),
  );
}
