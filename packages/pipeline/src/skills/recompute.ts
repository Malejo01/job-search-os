/**
 * Límite del recálculo de mercado y plan bajo demanda (ronda 28, D-029). Puro: recibe cuándo fue
 * el último recálculo y si quien llama cambió las entradas (niveles, ofertas nuevas), y decide.
 */
export const RECOMPUTE_WINDOW_MS = 10 * 60_000;
/** Mínimo de 10 s entre recálculos: solo contra el doble envío; un guardado de skills justo después del onboarding debe correr. */
export const RECOMPUTE_FLOOR_MS = 10_000;

export type RecomputeFacts = {
  now: Date;
  /** Último recálculo bajo demanda del usuario; null si nunca hubo. */
  lastRecomputeAt: Date | null;
  /** Lo dice quien llama: cambiaron las entradas del cálculo desde el último recálculo. */
  inputsChanged: boolean;
};

export type RecomputeDecision = { run: true } | { run: false; reason: "ventana" | "piso" };

export function recomputeDecision(facts: RecomputeFacts): RecomputeDecision {
  if (!facts.lastRecomputeAt) return { run: true };
  const elapsed = facts.now.getTime() - facts.lastRecomputeAt.getTime();
  // Con el reloj hacia atrás (elapsed negativo) también se saltea
  if (elapsed < RECOMPUTE_FLOOR_MS) return { run: false, reason: "piso" };
  if (facts.inputsChanged) return { run: true };
  if (elapsed < RECOMPUTE_WINDOW_MS) return { run: false, reason: "ventana" };
  return { run: true };
}
