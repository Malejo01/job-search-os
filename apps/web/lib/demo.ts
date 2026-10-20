import { readDemoEvaluations } from "@job-search-os/adapters";
import { DEMO_PROFILE_KEYS, type DemoProfileKey } from "@job-search-os/pipeline";
import { readPublicPool } from "./showcase";

/**
 * Lecturas de la demo guiada (ronda 74): evaluaciones ya guardadas en `demo_evaluations`, sin
 * usuario y sin LLM por visita. Mismo patrón que `lib/showcase.ts`: solo lectura, sin `withUser`,
 * y `null` cuando la app no tiene base (la página muestra "Estamos preparando la demo").
 */
export type DemoEvaluationRow = Awaited<ReturnType<typeof readDemoEvaluations>>[number];

/** Evaluaciones de un perfil, de mayor a menor puntaje. */
export function getDemoEvaluations(
  profileKey: DemoProfileKey,
): Promise<DemoEvaluationRow[] | null> {
  return readPublicPool((tx) => readDemoEvaluations(tx, profileKey));
}

/** Las de los tres perfiles en una sola transacción: el índice solo necesita contarlas. */
export function getDemoCounts(): Promise<Record<DemoProfileKey, number> | null> {
  return readPublicPool(async (tx) => {
    const counts = {} as Record<DemoProfileKey, number>;
    for (const key of DEMO_PROFILE_KEYS) counts[key] = (await readDemoEvaluations(tx, key)).length;
    return counts;
  });
}
