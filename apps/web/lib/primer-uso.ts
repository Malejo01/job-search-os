import { PRIMER_USO } from "./textos-rediseno";

/**
 * Lógica pura del recorrido de primer uso tras el rediseño (R23-05): qué pasos hay y cuándo se
 * muestra. Sin DOM ni `localStorage`: eso vive en `components/primer-uso.tsx`.
 *
 * Estado: `localStorage` del navegador (clave por persona y por versión del recorrido) y, desde R26-05,
 * la versión vista guardada en la cuenta (`profiles.primer_uso_visto`).
 */

export type PrimerUsoStep = { id: string; title: string; text: string };

/** Cambiar la versión vuelve a mostrar el recorrido en un próximo rediseño. */
export const PRIMER_USO_VERSION = "r23";
const VERSION = PRIMER_USO_VERSION;
export const PRIMER_USO_DONE = "hecho";

export function tourSteps(): readonly PrimerUsoStep[] {
  return PRIMER_USO.steps;
}

export function primerUsoKey(userId: string): string {
  return `jso-primer-uso:${VERSION}:${userId}`;
}

/**
 * ¿Se muestra? Sí si nunca se terminó ni se salteó. Un navegador automatizado (e2e) no lo ve salvo
 * que la prueba lo fuerce: el diálogo es modal y taparía las pantallas de las demás pruebas.
 *
 * R26-05: además del navegador (`stored`), cuenta lo guardado en la cuenta (`account`: la versión del
 * recorrido que la persona ya vio, `profiles.primer_uso_visto`). Así no reaparece en otro dispositivo
 * ni al borrar los datos del navegador. Cualquier cosa que no sea exactamente la versión vigente
 * (sin dato, una versión vieja, un valor raro, la consulta fallida) cuenta como no visto: falla
 * cerrado hacia mostrarlo de nuevo, nunca hacia romper. Forzar (solo e2e) ignora la cuenta.
 */
export function shouldShowPrimerUso(input: {
  stored: string | null;
  automated: boolean;
  forced?: boolean;
  account?: string | null | undefined;
}): boolean {
  if (input.stored === PRIMER_USO_DONE) return false;
  if (input.automated && !input.forced) return false;
  if (!input.forced && input.account === PRIMER_USO_VERSION) return false;
  return true;
}

export function clampStep(step: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(step, 0), total - 1);
}
