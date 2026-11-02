/**
 * Iniciales para el avatar del header (C7-5, manual P1): la primera letra de las dos primeras
 * palabras del nombre, en mayúscula. Lo que no es letra se saltea. Sin nombre usable, `null` y el
 * avatar muestra el ícono de perfil.
 */
export function initials(displayName: string): string | null {
  const letters = displayName
    .split(/\s+/)
    .map((word) => word.match(/\p{L}/u)?.[0])
    .filter((l): l is string => Boolean(l))
    .slice(0, 2);
  return letters.length > 0 ? letters.join("").toLocaleUpperCase("es-AR") : null;
}
