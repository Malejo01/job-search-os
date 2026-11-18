/**
 * Viñetas originales del CV (ADR-038 §7, D4). Puro. Una viñeta que propone el modelo solo vale si es
 * substring del texto leído en el mismo request, comparando sin mayúsculas ni acentos y con los espacios
 * colapsados (`foldCvText`). Lo que se devuelve es el pedazo del CV, no la versión del modelo: así la
 * tarjeta muestra lo que la persona escribió, con sus mayúsculas y acentos.
 */
import { foldCvText } from "../cv-out/verify";

/** Más corto que esto no es una viñeta: «Excel» o «2019» están en cualquier CV. */
export const CV_VERBATIM_MIN_CHARS = 12;

// Marcador de viñeta al arranque («- », «• », «1. »): el CV y el modelo los ponen distinto
const LEADING_MARK_RE = /^(?:[\s\-*•·▪●○◦–—]+|\d{1,2}[.)]\s+)/u;

/** Texto plegado (minúsculas, sin acentos, espacios colapsados) y, por cada carácter, su índice original. */
function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  let lastSpace = true; // sin espacio al arranque
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/u.test(ch)) {
      if (!lastSpace) {
        folded += " ";
        at.push(i);
        lastSpace = true;
      }
      continue;
    }
    const f = foldCvText(ch);
    for (const c of f) {
      folded += c;
      at.push(i);
    }
    if (f !== "") lastSpace = false;
  }
  return { folded, at };
}

function foldPlain(s: string): string {
  return foldCvText(s).replace(/\s+/gu, " ").trim();
}

/**
 * El pedazo del CV que corresponde a `candidate`, con los espacios colapsados, o `null` si no está tal cual
 * (o si es demasiado corto). Nunca completa ni corrige: sin coincidencia literal, no hay viñeta.
 */
export function cvVerbatim(text: string, candidate: string): string | null {
  const wanted = foldPlain(candidate.replace(LEADING_MARK_RE, ""));
  if (wanted.length < CV_VERBATIM_MIN_CHARS) return null;
  const { folded, at } = foldWithMap(text);
  const start = folded.indexOf(wanted);
  if (start < 0) return null;
  const end = start + wanted.length - 1;
  const from = at[start]!;
  // Hasta el final del carácter original (un carácter compuesto puede seguir con marcas combinadas)
  let to = at[end]! + 1;
  while (to < text.length && /\p{M}/u.test(text[to]!)) to++;
  return text.slice(from, to).replace(/\s+/gu, " ").trim();
}
