/**
 * Cómo se muestra un score de 0 a 10 (C7-4, manual M8). Lógica pura de `ScoreBadge`
 * (`apps/web/components/ui/score-badge.tsx`), acá para poder testearla.
 *
 * Estados: `alto` (7 o más), `medio` (5 a 6,9), `bajo`, `estimacion` (estimación previa por reglas),
 * `pendiente` (en cola) y `sin` (sin evaluar ni estimar).
 */
export type ScoreState = "alto" | "medio" | "bajo" | "estimacion" | "pendiente" | "sin";

export function scoreState({
  score,
  preScore = null,
  pending = false,
}: {
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
}): ScoreState {
  if (pending) return "pendiente";
  if (score === null) return preScore === null ? "sin" : "estimacion";
  if (score >= 7) return "alto";
  if (score >= 5) return "medio";
  return "bajo";
}

/** `aria-label` de la caja: «puntaje 8.5» (los e2e leen este formato, con punto). */
export function scoreAriaLabel(state: ScoreState, value: number | null): string {
  if (state === "pendiente") return "en cola";
  if (state === "sin") return "sin evaluar";
  if (state === "estimacion") return `estimación previa ${value}`;
  return `puntaje ${value}`;
}

/** La misma información como frase, para el modo `text` (lectores de pantalla en /hoy). */
export function scoreSentence(state: ScoreState, value: number | null): string {
  if (state === "pendiente") return "En cola para evaluar";
  if (state === "sin") return "Sin evaluar";
  if (state === "estimacion") return `Estimación previa ${value} de 10`;
  return `Puntaje ${value} de 10`;
}
