import { PRIMER_USO } from "./textos-rediseno";

/**
 * Lógica pura del recorrido de primer uso tras el rediseño (R23-05): qué pasos hay y cuándo se
 * muestra. Sin DOM ni `localStorage`: eso vive en `components/primer-uso.tsx`.
 *
 * Estado: no hay un lugar en la cuenta para esto (la cuenta no guarda preferencias de pantalla), así
 * que queda en `localStorage` del navegador, con la clave por persona y por versión del recorrido.
 */

export type PrimerUsoStep = { id: string; title: string; text: string };

/** Cambiar la versión vuelve a mostrar el recorrido en un próximo rediseño. */
const VERSION = "r23";
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
 */
export function shouldShowPrimerUso(input: {
  stored: string | null;
  automated: boolean;
  forced?: boolean;
}): boolean {
  if (input.stored === PRIMER_USO_DONE) return false;
  if (input.automated && !input.forced) return false;
  return true;
}

export function clampStep(step: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(step, 0), total - 1);
}
