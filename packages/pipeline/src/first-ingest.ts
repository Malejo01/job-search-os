/**
 * JS-125: qué partes de la primera ingesta (al terminar el onboarding) salen a la red de las
 * fuentes por API. Puro: recibe el entorno y las listas ya parseadas (`parsePoolSources` y
 * `parseEnabledSources` viven en adapters) y devuelve la decisión.
 *
 * Con `LLM_DEMO=1` (previews sin key, e2e y CI) no sale nada a la red: un pedido real puede volver
 * flaky un test o crear ofertas después de la limpieza. La asignación del pool y el recálculo de
 * mercado solo tocan la base y no dependen de esta decisión.
 */
export type FirstIngestNetworkPlan<S extends string = string> = {
  /** Ingesta por usuario de Get on Board (solo si `getonboard` no está en el pool). */
  getOnBoard: boolean;
  /** Fuentes de `INGEST_EXTRA_SOURCES` que se descargan. */
  extraSources: S[];
  /** true si se salteó la red por modo demo (para el log). */
  skippedForDemo: boolean;
};

export function planFirstIngestNetwork<S extends string>(
  env: Record<string, string | undefined>,
  parsed: { poolSources: readonly string[]; extraSources: readonly S[] },
): FirstIngestNetworkPlan<S> {
  if (env.LLM_DEMO === "1") return { getOnBoard: false, extraSources: [], skippedForDemo: true };
  return {
    getOnBoard: !parsed.poolSources.includes("getonboard"),
    extraSources: [...parsed.extraSources],
    skippedForDemo: false,
  };
}
