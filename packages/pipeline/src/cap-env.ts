/**
 * Lectura de topes de gasto y de uso desde variables de entorno. Pura: recibe `env` (el borde pasa
 * `process.env`) y devuelve un número validado. Falla cerrado al valor conocido: una variable ausente,
 * vacía o inválida (no numérica, cero, negativa, con exponente, fuera del máximo) devuelve el default y no
 * rompe nunca. Los límites de seguridad de entrada (tamaños, timeouts, largo de campos) no pasan por acá.
 */
export type CapEnv = Record<string, string | undefined>;

export interface CapReadOptions {
  /** `int`: solo dígitos. `decimal`: dígitos con punto decimal opcional. */
  kind: "int" | "decimal";
  /** Techo opcional: un valor mayor se descarta y vale el default. */
  max?: number;
}

export type CapSource = "default" | "env" | "invalid";

const INT_RE = /^\d{1,9}$/;
const DECIMAL_RE = /^\d{1,9}(\.\d{1,6})?$/;

/** Como `readCap`, e informa si el valor vino de la variable, del default o de una variable inválida. */
export function readCapChecked(
  env: CapEnv,
  name: string,
  fallback: number,
  opts: CapReadOptions,
): { value: number; source: CapSource } {
  const raw = env[name]?.trim() ?? "";
  if (raw === "") return { value: fallback, source: "default" };
  if (!(opts.kind === "int" ? INT_RE : DECIMAL_RE).test(raw)) {
    return { value: fallback, source: "invalid" };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !(n > 0) || (opts.max !== undefined && n > opts.max)) {
    return { value: fallback, source: "invalid" };
  }
  return { value: n, source: "env" };
}

/** Número positivo de la variable `name`, o `fallback` si falta o es inválido. */
export function readCap(env: CapEnv, name: string, fallback: number, opts: CapReadOptions): number {
  return readCapChecked(env, name, fallback, opts).value;
}
