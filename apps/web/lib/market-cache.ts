/**
 * Configuración del caché de candidatos de /market. Pura (sin imports) para poder testearla sin
 * servidor de Next. Clave y tag incluyen el usuario: el caché nunca se comparte entre usuarios.
 */

/**
 * Versión de la forma del valor cacheado. El Data Cache de Vercel persiste entre deploys: si
 * cambia la forma de `SkillCandidate[]`, subir a "v2" para no leer valores viejos.
 */
const CANDIDATES_CACHE_VERSION = "v1";

/** Sin invalidación por eventos todavía: 1 h de atraso alcanza para un agregado. */
const CANDIDATES_REVALIDATE_SECONDS = 3600;

export function candidatesCacheConfig(userId: string): {
  keyParts: string[];
  tags: string[];
  revalidate: number;
} {
  return {
    keyParts: ["market-candidates", CANDIDATES_CACHE_VERSION, userId],
    tags: [`market-candidates:${userId}`],
    revalidate: CANDIDATES_REVALIDATE_SECONDS,
  };
}
