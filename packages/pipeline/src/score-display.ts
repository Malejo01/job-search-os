/**
 * Cómo se muestra un puntaje de 0 a 10. Lógica pura, acá para poder testearla.
 *
 * - `scoreState` (C7-4): los tres tramos viejos, `alto` (7 o más), `medio` (5 a 6,9) y `bajo`, más
 *   `estimacion` (estimación previa por reglas), `pendiente` (en cola) y `sin` (sin evaluar).
 * - `sealState` (C9-5, decisión 7 de C9): el sello de afinidad que reemplaza a ScoreBadge. Parte
 *   los mismos tramos (respeta los cortes de 7 y 5) en cinco niveles, cada uno con su palabra.
 */
export type ScoreState = "alto" | "medio" | "bajo" | "estimacion" | "pendiente" | "sin";

/** Niveles del sello: 8,5 a 10, 7 a 8,4, 5 a 6,9, 3 a 4,9 y menos de 3. */
export type SealLevel = "muy" | "bastante" | "medias" | "poco" | "lejos";
export type SealState = SealLevel | "estimacion" | "pendiente" | "sin";

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

export function sealLevel(score: number): SealLevel {
  if (score >= 8.5) return "muy";
  if (score >= 7) return "bastante";
  if (score >= 5) return "medias";
  if (score >= 3) return "poco";
  return "lejos";
}

export function sealState({
  score,
  preScore = null,
  pending = false,
}: {
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
}): SealState {
  if (pending) return "pendiente";
  if (score === null) return preScore === null ? "sin" : "estimacion";
  return sealLevel(score);
}

const SEAL_WORDS: Record<SealState, string> = {
  muy: "Muy afín",
  bastante: "Bastante afín",
  medias: "Afín a medias",
  poco: "Poco afín",
  lejos: "Lejos de tu perfil",
  estimacion: "Estimado",
  sin: "Sin evaluar",
  pendiente: "Leyendo la oferta contra tu perfil…",
};

/** La palabra debajo del número: siempre está, el color nunca es la única señal. */
export function sealWord(state: SealState): string {
  return SEAL_WORDS[state];
}

/**
 * «Lejos de tu perfil»: puntaje del modelo menor a 3. Una oferta sin puntaje (en cola, estimada o
 * sin evaluar) no es lejana: todavía no se sabe.
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

/**
 * `aria-label` del sello o de la caja: «puntaje 8.5» (los e2e leen este formato, con punto). En el
 * sello suma la palabra del nivel («puntaje 8.5, muy afín»): el sello es una imagen y su palabra
 * no se lee aparte, así el significado no depende del color tampoco para un lector (R-3).
 */
export function scoreAriaLabel(state: ScoreState | SealState, value: number | null): string {
  if (state === "pendiente") return "en cola";
  if (state === "sin") return "sin evaluar";
  if (state === "estimacion") return `estimación previa ${value}`;
  const base = `puntaje ${value}`;
  return state in LEVEL_PHRASE ? `${base}, ${LEVEL_PHRASE[state as SealLevel]}` : base;
}

const LEVEL_PHRASE: Record<SealLevel, string> = {
  muy: "muy afín",
  bastante: "bastante afín",
  medias: "afín a medias",
  poco: "poco afín",
  lejos: "lejos de tu perfil",
};

/** La misma información como frase, para el modo `text` (lectores de pantalla en /hoy). */
export function scoreSentence(state: ScoreState | SealState, value: number | null): string {
  if (state === "pendiente") return "En cola para evaluar";
  if (state === "sin") return "Sin evaluar";
  if (state === "estimacion") return `Estimación previa ${value} de 10`;
  const base = `Puntaje ${value} de 10`;
  return state in LEVEL_PHRASE ? `${base}, ${LEVEL_PHRASE[state as SealLevel]}` : base;
}
