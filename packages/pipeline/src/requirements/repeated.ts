import type { ChecklistItem } from "../evaluator/checklist";
import { summarizeRequirements } from "./summary";

/**
 * «Esto mismo te pasa en N de tus M ofertas» (R31-08, S-18). Puro: cuenta, sobre las tablas de
 * requisitos de las ofertas abiertas de la persona, en cuántas un mismo dato del perfil está sin
 * confirmar o no coincide. No llama a ningún modelo: el estado de cada fila lo resuelve el código
 * (`summarizeRequirements`), así que al guardar el dato basta con volver a calcular.
 */

/** Dato del perfil que se puede actualizar: `ingles`, `anos`, `pais`, `residencia`, `autorizacion` o `skill:<slug>`. */
export type ProfileFieldKey = string;

export type OpenOfferTable = { jobId: string; items: readonly ChecklistItem[] };

export type RepeatedField = {
  field: ProfileFieldKey;
  /** Ofertas donde ese dato no coincide o está sin confirmar. */
  n: number;
  /** Ofertas abiertas con tabla de requisitos. */
  m: number;
  jobIds: string[];
};

const PROFILE_CODES: ReadonlySet<string> = new Set([
  "ingles",
  "anos",
  "pais",
  "residencia",
  "autorizacion",
]);

/** Campo del perfil que resuelve una fila de la tabla, o null si no hay un dato que cargar. */
export function fieldKeyOf(id: string): ProfileFieldKey | null {
  if (PROFILE_CODES.has(id)) return id;
  if (id.startsWith("skill:") && id.length > "skill:".length) return id;
  return null;
}

function tablesWithRows(offers: readonly OpenOfferTable[]) {
  return offers
    .map((o) => ({ jobId: o.jobId, rows: summarizeRequirements({ items: [...o.items] }).rows }))
    .filter((o) => o.rows.length > 0);
}

type Tables = ReturnType<typeof tablesWithRows>;

function countField(tables: Tables, field: ProfileFieldKey): RepeatedField {
  const jobIds = tables
    .filter((t) => t.rows.some((r) => r.id === field && r.state !== "coincide"))
    .map((t) => t.jobId);
  return { field, n: jobIds.length, m: tables.length, jobIds };
}

/** N de M para un campo. */
export function repeatedForField(
  offers: readonly OpenOfferTable[],
  field: ProfileFieldKey,
): RepeatedField {
  return countField(tablesWithRows(offers), field);
}

/** Todos los campos que se repiten en 2 o más ofertas, de mayor a menor (empate: orden de aparición). */
export function repeatedFields(offers: readonly OpenOfferTable[]): RepeatedField[] {
  const tables = tablesWithRows(offers);
  const order: ProfileFieldKey[] = [];
  for (const t of tables) {
    for (const r of t.rows) {
      const key = fieldKeyOf(r.id);
      if (key && !order.includes(key)) order.push(key);
    }
  }
  return order
    .map((f, i) => ({ r: countField(tables, f), i }))
    .filter(({ r }) => r.n >= 2)
    .sort((a, b) => b.r.n - a.r.n || a.i - b.i)
    .map(({ r }) => r);
}
