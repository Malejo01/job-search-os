/**
 * Enmascarado de las métricas que ve una institución (C-16 §3.2 y §3.3, ticket B2B-2). Puro. La
 * institución es un tercero que conoce a las personas: por eso k = 5 (no el 3 del tablero del
 * admin), conteos de personas en rangos por debajo de 20, porcentajes redondeados a 5 y la regla
 * complementaria por cohorte contra el ataque por diferencia.
 */
export const ORG_K = 5;

export type PeopleBucket = "<5" | "5-9" | "10-19" | "20+";

/** Rango de un conteo de personas: nunca el número exacto por debajo de 20. */
export function peopleBucket(n: number): PeopleBucket {
  if (n < ORG_K) return "<5";
  if (n < 10) return "5-9";
  if (n < 20) return "10-19";
  return "20+";
}

/**
 * Un conteo que sale de un grupo de personas: null si las personas detrás son menos de k. Ojo:
 * cuenta personas, no filas (7 entrevistas de 2 personas se suprimen). Con menos de 20 personas
 * detrás va redondeado a 5 y nunca por debajo de 5 (la pantalla lo muestra como «hasta 5»): un 0
 * exacto diría que nadie lo hizo, y eso ya es un dato de cada persona.
 */
export function maskedCount(value: number, people: number): number | null {
  if (people < ORG_K) return null;
  return people < 20 ? Math.max(5, Math.round(value / 5) * 5) : value;
}

/**
 * Porcentaje entero; null por debajo de k. Con base menor que 20 va redondeado a 5 y acotado entre 5
 * y 95 (la pantalla muestra «5 % o menos» y «95 % o más»): un 0 % o un 100 % con base chica dice lo
 * que hizo cada una de las personas.
 */
export function maskedPercent(part: number, base: number): number | null {
  if (base < ORG_K) return null;
  const pct = (part / base) * 100;
  if (base >= 20) return Math.round(pct);
  return Math.min(95, Math.max(5, Math.round(pct / 5) * 5));
}

/**
 * Regla complementaria (§3.3, punto 2): una cohorte se publica solo si ella y «el resto de la
 * organización» tienen al menos k personas con consentimiento. Si una cohorte no se puede publicar,
 * la que queda como único «resto» tampoco: devuelve qué cohortes se pueden mostrar por separado.
 */
export function publishableCohorts(peopleByCohort: ReadonlyMap<string, number>): Set<string> {
  const total = [...peopleByCohort.values()].reduce((a, b) => a + b, 0);
  const ok = new Set<string>();
  for (const [cohort, people] of peopleByCohort) {
    if (people >= ORG_K && total - people >= ORG_K) ok.add(cohort);
  }
  // Si hay una cohorte que no se publica, cualquier otra cohorte publicada permitiría deducirla por
  // diferencia con el total: con dos cohortes, si una cae, caen las dos
  const hidden = [...peopleByCohort.keys()].filter((c) => !ok.has(c));
  const hiddenPeople = hidden.reduce((a, c) => a + (peopleByCohort.get(c) ?? 0), 0);
  if (hidden.length > 0 && hiddenPeople < ORG_K) ok.clear();
  return ok;
}
