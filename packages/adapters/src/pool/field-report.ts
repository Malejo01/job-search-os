/**
 * Reporte de presencia de campos para `pool:fetch --dry-run`: contrasta el formato real de una
 * fuente con lo que lee su mapper, sin imprimir nunca un valor (solo conteos y tipos).
 */
export type FieldPresence = {
  field: string;
  /** Items que traen el campo (no `null`, `undefined` ni `""`). */
  present: number;
  /** Cantidad de items por tipo: `string`, `number`, `boolean`, `array`, `object`. */
  types: Record<string, number>;
};

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/** Puro. Un item que no es un objeto no aporta a ningún campo. */
export function fieldPresence(
  items: readonly unknown[],
  fields: readonly string[],
): FieldPresence[] {
  return fields.map((field) => {
    let present = 0;
    const types: Record<string, number> = {};
    for (const item of items) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const value = (item as Record<string, unknown>)[field];
      if (value === null || value === undefined || value === "") continue;
      present++;
      const t = typeOf(value);
      types[t] = (types[t] ?? 0) + 1;
    }
    return { field, present, types };
  });
}

/** Texto con porcentajes sobre `total` items. No incluye valores, solo nombres de campo, conteos y tipos. */
export function formatFieldReport(rows: readonly FieldPresence[], total: number): string {
  if (rows.length === 0) return "(sin campos)";
  const width = Math.max(...rows.map((r) => r.field.length));
  return rows
    .map((r) => {
      const pct = total > 0 ? Math.round((r.present / total) * 100) : 0;
      const types = Object.entries(r.types)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([t, n]) => `${t}=${n}`)
        .join(", ");
      return `${r.field.padEnd(width)}  ${r.present}/${total} (${pct}%)${types ? `  ${types}` : ""}`;
    })
    .join("\n");
}
