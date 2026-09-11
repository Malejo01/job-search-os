/** Utilidades de texto compartidas por las normalizaciones. Sin I/O. */

/** Minúsculas y sin diacríticos ("Tecnología" → "tecnologia"). */
export function foldText(input: string): string {
  return input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Quita paréntesis (incluidos anidados) y corchetes con su contenido. */
export function stripBrackets(input: string): string {
  let out = input;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/\([^()]*\)/g, " ").replace(/\[[^[\]]*\]/g, " ");
  } while (out !== prev);
  return out;
}

/** Colapsa espacios y recorta. */
export function squash(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
