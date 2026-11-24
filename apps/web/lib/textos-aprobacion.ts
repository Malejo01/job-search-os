import { sha256Hex } from "./academy";
import * as textosModulo from "./textos-rediseno";

/**
 * Los textos de `textos-rediseno.ts` como una lista plana para aprobarlos desde la app (R26-02). Cada texto es una
 * hoja de texto de lo que exporta ese archivo; su clave es la ruta (`AFFINITY_WORDS.high`,
 * `PRIMER_USO.steps.0.title`) y su huella, el sha256 del texto de hoy: si el código cambia el texto, la
 * aprobación guardada ya no vale. Se omiten las hojas `id` y `slug` (identificadores técnicos, no textos).
 * Solo servidor (usa `sha256Hex`).
 */

export type TextoRediseno = {
  /** Ruta del texto dentro del archivo. */
  clave: string;
  /** Nombre de la constante que lo contiene (el primer tramo de la clave). */
  grupo: string;
  /** El texto por defecto, tal como se ve hoy. */
  valor: string;
  /** sha256 del texto por defecto. */
  huella: string;
};

const OMITIR = new Set(["id", "slug"]);

function recorrer(value: unknown, ruta: string[], out: { ruta: string[]; valor: string }[]): void {
  if (typeof value === "string") {
    if (value.length > 0 && !OMITIR.has(ruta[ruta.length - 1] ?? ""))
      out.push({ ruta, valor: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => recorrer(v, [...ruta, String(i)], out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) recorrer(v, [...ruta, k], out);
  }
}

/** Aplana un módulo de textos (o cualquier objeto) en la lista de textos aprobables. Orden estable por clave. */
export function aplanarTextos(source: Record<string, unknown>): TextoRediseno[] {
  const hojas: { ruta: string[]; valor: string }[] = [];
  for (const [nombre, value] of Object.entries(source)) recorrer(value, [nombre], hojas);
  return hojas
    .map(({ ruta, valor }) => ({
      clave: ruta.join("."),
      grupo: ruta[0]!,
      valor,
      huella: sha256Hex(valor),
    }))
    .sort((a, b) => a.clave.localeCompare(b.clave));
}

let memo: TextoRediseno[] | null = null;

/** Todos los textos del rediseño de hoy. */
export function textosRediseno(): TextoRediseno[] {
  memo ??= aplanarTextos(textosModulo as unknown as Record<string, unknown>);
  return memo;
}
