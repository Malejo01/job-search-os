import { ATS_PROVIDERS, isValidAtsToken, type AtsProvider } from "../sources/ats-common";

/**
 * Reporte de presencia de campos para `pool:fetch --dry-run`: contrasta el formato real de una
 * fuente con lo que lee su mapper, sin imprimir nunca un valor (solo conteos y tipos).
 */

export const POOL_CLI_SOURCES = [
  "getonboard",
  "remoteok",
  "jobicy",
  "himalayas",
  "wwr",
  ...ATS_PROVIDERS,
] as const;
export type PoolCliSource = (typeof POOL_CLI_SOURCES)[number];

export type PoolCliArgs =
  | { ok: true; source: Exclude<PoolCliSource, AtsProvider> }
  | {
      ok: true;
      source: AtsProvider;
      token: string;
      region: "eu" | null;
      /** `--company`; si falta se usa el token. */
      company: string;
    }
  | { ok: false; error: string };

const USAGE = `uso: pnpm pool:fetch <getonboard|remoteok|jobicy|himalayas|wwr> --dry-run
     pnpm pool:fetch <${ATS_PROVIDERS.join("|")}> <token> [--region eu] [--company "Nombre"] --dry-run`;

/** Argumentos de `pool:fetch` (sin `node` ni el script). Puro: el token se valida antes de cualquier request. */
export function parsePoolCliArgs(argv: readonly string[]): PoolCliArgs {
  const positional: string[] = [];
  let dryRun = false;
  let region: string | null = null;
  let company: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") dryRun = true;
    else if (a === "--region" || a.startsWith("--region=")) {
      region = a === "--region" ? (argv[++i] ?? "") : a.slice("--region=".length);
    } else if (a === "--company" || a.startsWith("--company=")) {
      company = a === "--company" ? (argv[++i] ?? "") : a.slice("--company=".length);
    } else if (a.startsWith("--"))
      return { ok: false, error: `opción desconocida: ${a}\n${USAGE}` };
    else positional.push(a);
  }
  const source = positional[0];
  if (!source || !(POOL_CLI_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, error: USAGE };
  }
  if (!dryRun) return { ok: false, error: "pool:fetch: solo existe el modo --dry-run" };
  const isAts = (ATS_PROVIDERS as readonly string[]).includes(source);
  if (!isAts) {
    if (positional.length > 1 || region !== null || company !== null) {
      return { ok: false, error: `${source} no lleva token, --region ni --company\n${USAGE}` };
    }
    return { ok: true, source: source as Exclude<PoolCliSource, AtsProvider> };
  }
  const token = positional[1];
  if (!token || positional.length > 2)
    return { ok: false, error: `falta el token del board\n${USAGE}` };
  if (!isValidAtsToken(token)) {
    return { ok: false, error: "token inválido: solo letras, números, '.', '_' y '-' (máx. 100)" };
  }
  if (region !== null && !(source === "lever" && region === "eu")) {
    return { ok: false, error: "--region solo admite 'eu' y solo en lever" };
  }
  if (company !== null && !company.trim()) return { ok: false, error: "--company vacío" };
  return {
    ok: true,
    source: source as AtsProvider,
    token,
    region: region === "eu" ? "eu" : null,
    company: company?.trim().slice(0, 100) || token,
  };
}
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
