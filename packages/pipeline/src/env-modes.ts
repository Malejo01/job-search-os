/**
 * Lectura de variables de configuración (modos y plazos) sin I/O: reciben el valor crudo y devuelven el
 * valor y, si el valor no se entiende, un mensaje de error para que el adapter lo registre. Ante un valor
 * desconocido nunca se adivina: rige el valor por defecto (la protección que el modo apagaría queda como
 * estaba) y el error avisa. El valor mal escrito no se copia al mensaje.
 */
export type ConfigRead<T> = { value: T; error: string | null };

/** Modo de una variable: recorta espacios, ignora mayúsculas y acepta solo los valores conocidos. */
export function readMode<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): ConfigRead<T> {
  const text = raw?.trim().toLowerCase();
  if (!text) return { value: fallback, error: null };
  const known = allowed.find((mode) => mode === text);
  if (known) return { value: known, error: null };
  return {
    value: fallback,
    error: `${name} tiene un valor desconocido (valores válidos: ${allowed.join(", ")}): rige «${fallback}»`,
  };
}

/** Entero entre `min` y `max`. Ausente o vacío no es un error: `null`. Cualquier otra cosa es un error. */
export function readIntegerSetting(
  name: string,
  raw: string | undefined,
  min: number,
  max: number,
): ConfigRead<number | null> {
  const text = raw?.trim();
  if (!text) return { value: null, error: null };
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isInteger(n) && n >= min && n <= max) return { value: n, error: null };
  return {
    value: null,
    error: `${name} no es un entero de ${min} a ${max}: la función queda apagada`,
  };
}
