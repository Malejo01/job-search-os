import { foldText, squash, stripBrackets } from "./text";

/**
 * Sufijos legales o genéricos que no identifican a la empresa. Se quitan solo al final
 * del nombre y de forma repetida ("Acme Labs LLC" → "acme").
 */
const LEGAL_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "srl",
  "sa",
  "sas",
  "sl",
  "sac",
  "sapi",
  "cv",
  "corp",
  "corporation",
  "co",
  "gmbh",
  "ag",
  "plc",
  "bv",
  "pty",
  "labs",
  "group",
]);

/** Separadores "recruiter → empresa": nos quedamos con la empresa (último tramo). */
const RECRUITER_ARROW = /\s*(?:→|->|=>|»)\s*/;

/** "vía X", "via X", "a través de X", "through X" hasta el final. */
const VIA_SUFFIX = /\s+(?:via|a traves de|through)\s+.*$/;

/**
 * Normaliza el nombre de una empresa para comparar y agrupar:
 * minúsculas sin diacríticos, sin paréntesis, sin "vía X", sin sufijos legales.
 * Nunca devuelve vacío si el nombre original tenía algún token.
 */
export function normalizeCompany(raw: string): string {
  const arrowParts = raw.split(RECRUITER_ARROW).filter((p) => p.trim().length > 0);
  const base = arrowParts.length > 0 ? arrowParts[arrowParts.length - 1]! : raw;

  let text = foldText(stripBrackets(base));
  text = text.replace(VIA_SUFFIX, " ");
  // Puntuación → espacio ("S.A." → "s a", "Acme, Inc" → "acme inc"), después se agrupan sufijos
  text = text.replace(/[^a-z0-9]+/g, " ");
  const tokens = squash(text).split(" ").filter(Boolean);
  if (tokens.length === 0) return "";

  // "s a" / "s r l" quedan como tokens sueltos tras quitar puntos: los unimos para reconocerlos
  const joined = joinDottedSuffixes(tokens);

  let end = joined.length;
  while (end > 1 && LEGAL_SUFFIXES.has(joined[end - 1]!)) end--;
  return joined.slice(0, end).join(" ");
}

/** Une secuencias finales de letras sueltas ("s a" → "sa", "s r l" → "srl"). */
function joinDottedSuffixes(tokens: string[]): string[] {
  const out = [...tokens];
  while (out.length >= 2) {
    const tail: string[] = [];
    let i = out.length - 1;
    while (i >= 0 && out[i]!.length === 1 && tail.length < 4) {
      tail.unshift(out[i]!);
      i--;
    }
    if (tail.length < 2) break;
    const candidate = tail.join("");
    if (!LEGAL_SUFFIXES.has(candidate)) break;
    out.splice(out.length - tail.length, tail.length, candidate);
  }
  return out;
}
