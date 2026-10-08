import { foldText, squash, stripBrackets } from "./text";

/**
 * Ubicación normalizada para comparar dos avisos (dedup, JS-085): minúsculas, sin acentos, sin
 * paréntesis ni "remoto"/"remote". Si no queda nada, `null` (ubicación desconocida).
 */
export function normalizeLocation(input: string | null | undefined): string | null {
  if (!input) return null;
  const out = squash(
    stripBrackets(foldText(input))
      .replace(/\b(?:remoto|remota|remote)\b/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s,;/|-]+|[\s,;/|-]+$/g, ""),
  );
  return out || null;
}
