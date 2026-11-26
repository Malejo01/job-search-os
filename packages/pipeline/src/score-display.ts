/**
 * Cómo se muestra un puntaje de 0 a 10 (R30-02, plan R30 a R34 §4). Lógica pura, acá para poder testearla.
 *
 * Cuatro sellos de afinidad: `alta` (7 o más), `media` (de 5 a 6,9), `baja` (menos de 5) y `sin_evaluar` (todavía
 * no hay evaluación). Más `pendiente` (la oferta está en cola). Esta función devuelve niveles y códigos; las
 * palabras («Afinidad alta») las pone la web desde `textos-rediseno.ts`.
 *
 * El número se muestra con un decimal y coma («7,4») y **el corte usa el número ya redondeado a un decimal**: un
 * 6,96 se ve «7,0» y es «alta»; un 6,94 se ve «6,9» y es «media». Así el número nunca contradice al sello.
 * La estimación previa (sin IA) nunca es un sello: una oferta sin evaluación es «Sin evaluar», aunque tenga estimación.
 */
export type SealLevel = "alta" | "media" | "baja";
export type SealState = SealLevel | "sin_evaluar" | "pendiente";

/** El puntaje redondeado a un decimal, el que se ve y con el que se corta. */
export function roundScore(score: number): number {
  // `toFixed` corrige el ruido de coma flotante de `Math.round(x * 10) / 10` (4,95 * 10 = 49,49999…)
  return Number(score.toFixed(1)) + 0;
}

/** «7,4»: un decimal y coma, siempre (también «7,0»). Es el texto del sello y de la frase «7,4/10». */
export function formatAffinityScore(score: number): string {
  return roundScore(score).toFixed(1).replace(".", ",");
}

export function sealLevel(score: number): SealLevel {
  const rounded = roundScore(score);
  if (rounded >= 7) return "alta";
  if (rounded >= 5) return "media";
  return "baja";
}

export function sealState({
  score,
  pending = false,
}: {
  score: number | null;
  pending?: boolean;
}): SealState {
  if (pending) return "pendiente";
  if (score === null) return "sin_evaluar";
  return sealLevel(score);
}

/**
 * «Lejos de tu perfil»: puntaje del modelo menor a 3. Una oferta sin puntaje (en cola o sin evaluar) no es
 * lejana: todavía no se sabe. (El orden nuevo del listado lo define R30-04; esto sigue valiendo hasta entonces.)
 */
export function isFarFromProfile(score: number | null): boolean {
  return score !== null && score < 3;
}

/**
 * En la lista de ofertas las lejanas van siempre al final, debajo de su separador, sea cual sea el
 * orden elegido (decisión 7). Separa sin cambiar el orden de cada grupo.
 */
export function splitFarFromProfile<T>(
  items: readonly T[],
  scoreOf: (item: T) => number | null,
): { near: T[]; far: T[] } {
  const near: T[] = [];
  const far: T[] = [];
  for (const item of items) (isFarFromProfile(scoreOf(item)) ? far : near).push(item);
  return { near, far };
}
