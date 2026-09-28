import { foldText, squash } from "../normalize/text";

/**
 * Banco de respuestas aprobadas (JS-053). Normalizar la pregunta es lo que hace que "What are your
 * salary expectations?*" y "what are your salary expectations" sean la misma fila en answer_bank.
 */
export function normalizeQuestion(raw: string): string {
  return squash(foldText(raw).replace(/[^a-z0-9]+/g, " "));
}

// Palabras que no distinguen una pregunta de otra en un formulario (español e inglés)
const STOPWORDS = new Set(
  [
    "a an and are as at be can do does for have how in is it of on or the to what when which with",
    "you your please",
    "al con cual cuales de del el en es la las lo los o para por que se su sus tu tus un una y",
  ]
    .join(" ")
    .split(" "),
);

export function questionTokens(raw: string): string[] {
  return normalizeQuestion(raw)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

const MIN_PREFIX = 4;

/** Una palabra de la consulta coincide si es igual o, con 4+ letras, prefijo de la otra. */
function tokenMatches(q: string, candidate: string): boolean {
  return q === candidate || (q.length >= MIN_PREFIX && candidate.startsWith(q));
}

/**
 * Ordena respuestas del banco para una consulta. Sin consulta: todas, la más reciente primero.
 * Con consulta: solo las que comparten al menos una palabra, primero las de más coincidencias y,
 * a igualdad, la más reciente. El banco es chico (decenas), así que se ordena en memoria.
 */
export function rankAnswers<T extends { question: string; updatedAt: Date }>(
  answers: readonly T[],
  query: string | undefined,
  limit: number,
): T[] {
  const byRecent = (x: T, y: T) => y.updatedAt.getTime() - x.updatedAt.getTime();
  if (!query || query.trim() === "") return [...answers].sort(byRecent).slice(0, limit);

  const q = questionTokens(query);
  if (q.length === 0) return [];
  return answers
    .map((answer) => {
      const tokens = questionTokens(answer.question);
      const hits = q.filter((t) => tokens.some((c) => tokenMatches(t, c))).length;
      return { answer, hits };
    })
    .filter((r) => r.hits > 0)
    .sort((x, y) => y.hits - x.hits || byRecent(x.answer, y.answer))
    .slice(0, limit)
    .map((r) => r.answer);
}
