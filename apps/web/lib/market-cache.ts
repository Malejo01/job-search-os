/**
 * Configuración del caché de candidatos de /market. Pura (sin imports) para poder testearla sin
 * servidor de Next. Clave y tag incluyen el usuario: el caché nunca se comparte entre usuarios.
 */

/**
 * Versión de la forma del valor cacheado. El Data Cache de Vercel persiste entre deploys: si
 * cambia la forma de `SkillCandidate[]`, subir a "v2" para no leer valores viejos.
 */
const CANDIDATES_CACHE_VERSION = "v1";

/**
 * 6 h (C5-7, ahorro de Neon). Cada recálculo lee el texto de hasta 300 avisos (≈1 MB). Las ofertas nuevas
 * entran con el cron de ingesta, que corre cada 6 h, así que un agregado más fresco no tiene qué mostrar; las
 * altas manuales y el pegado de JD invalidan el caché a mano (`revalidateTag`). Antes: 1 h.
 */
const CANDIDATES_REVALIDATE_SECONDS = 21_600;

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
