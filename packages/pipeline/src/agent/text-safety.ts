/**
 * Caracteres que no van en un texto que se muestra o se guarda: de control (incluidos los C1), de
 * formato invisibles (bidi, ancho cero) y los separadores de línea y de párrafo de Unicode. Con
 * ellos se puede falsear lo que muestra una tarjeta. Compartido por propuestas y acciones.
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** Igual, pero deja pasar el salto de línea (textos de varias líneas, como el resumen). */
const UNSAFE_MULTILINE = /[\p{Cf}\p{Zl}\p{Zp}]|(?!\n)\p{Cc}/u;
/** Solo los invisibles (para las citas, que se comparan normalizadas). */
export const INVISIBLE_CHARS = /[\p{Cf}\p{Zl}\p{Zp}]/u;

export function hasUnsafeChars(text: string, allowNewlines = false): boolean {
  return (allowNewlines ? UNSAFE_MULTILINE : UNSAFE).test(text);
}
