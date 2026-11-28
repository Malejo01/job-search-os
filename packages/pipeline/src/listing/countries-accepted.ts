import { allowsCountry, locationScope } from "../pool/location-scope";

/**
 * «Aceptan {tu país}» (R30-05). Solo cuenta lo que el aviso dice **explícito** en `countries_allowed`:
 * el país, su región o todo el mundo. Lo que es `null`, está vacío o no se entiende no entra: nunca se
 * asume «cualquier país». No mira el texto de la ubicación (`location_raw`), a diferencia del prefiltro.
 */
export function acceptsCountry(
  countriesAllowed: readonly string[] | null | undefined,
  iso2: string | null | undefined,
): boolean {
  const country = iso2?.trim();
  if (!country || !countriesAllowed?.length) return false;
  // Sin `locationRaw`: el alcance sale solo de la lista
  const entries = countriesAllowed.map((e) =>
    /^[a-z]{2}$/i.test(e.trim()) ? e.trim().toUpperCase() : e,
  );
  const scope = locationScope(null, entries);
  if (scope.kind === "any") return true;
  if (scope.kind === "unknown") return false;
  return allowsCountry(scope, country);
}
