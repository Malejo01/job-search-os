import { writeFileSync } from "node:fs";
import { normalizeCompany } from "@job-search-os/pipeline";
import { createDb } from "./client";
import { describeDatabaseUrl, loadLocalEnv, requireDatabaseUrl } from "./env";

/**
 * JS-086, migración de datos (propuesta de #246). Script de una sola vez y de SOLO LECTURA:
 * busca las filas cuyo nombre de empresa tiene «labs» o «group», recalcula `normalizeCompany`
 * con la regla nueva y escribe un archivo SQL para revisar. No escribe en la base.
 *
 *   pnpm --filter @job-search-os/db exec tsx src/renorm-companies.ts --out renorm-companies.sql
 *   (agregar --local para Docker; sin --local va contra Neon con la conexión dueña)
 *
 * El SQL generado corre en una transacción, muestra los conteos y termina en COMMIT. Se revisa
 * y se aplica a mano (Neon → SQL Editor, base `jobsearch`). Lo que el script NO toca, a propósito:
 * flags `posible_duplicado`, `public_jobs.dedup_of_id`, `contacts` y empresas huérfanas.
 */

export type RenormRow = { id: string; raw: string; current: string | null };
export type RenormChange = { id: string; newNorm: string; displayName: string };

/** Misma lógica de nombre visible que `upsertCompany` y el upsert del pool. */
export function companyDisplayName(companyRaw: string): string {
  return companyRaw.replace(/\s*\(.*$/, "").trim() || companyRaw;
}

/** Solo las filas cuya normalización cambia con la regla nueva (y no queda vacía). */
export function changedRows(rows: RenormRow[]): RenormChange[] {
  const out: RenormChange[] = [];
  for (const r of rows) {
    const newNorm = normalizeCompany(r.raw);
    if (!newNorm || newNorm === r.current) continue;
    out.push({ id: r.id, newNorm, displayName: companyDisplayName(r.raw) });
  }
  return out;
}

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

function valuesBlock(table: string, rows: RenormChange[]): string {
  if (rows.length === 0) return `-- ${table}: sin filas para cambiar`;
  const values = rows
    .map((r) => `  (${lit(r.id)}::uuid, ${lit(r.newNorm)}, ${lit(r.displayName)})`)
    .join(",\n");
  return `INSERT INTO ${table} (id, new_norm, display_name) VALUES\n${values};`;
}

export function buildSql(pool: RenormChange[], jobs: RenormChange[], generatedAt: string): string {
  return `-- JS-086 · re-normalización de empresas con «labs» y «group» (generado ${generatedAt})
-- Filas del pool a cambiar: ${pool.length} · ofertas de usuarios a cambiar: ${jobs.length}
-- Revisar antes de correr. Base: jobsearch. Si algo no cierra, cambiar COMMIT por ROLLBACK.
BEGIN;

CREATE TEMP TABLE renorm_public_jobs (id uuid PRIMARY KEY, new_norm text NOT NULL, display_name text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE renorm_jobs        (id uuid PRIMARY KEY, new_norm text NOT NULL, display_name text NOT NULL) ON COMMIT DROP;

${valuesBlock("renorm_public_jobs", pool)}

${valuesBlock("renorm_jobs", jobs)}

-- Empresas nuevas que hagan falta (las que ya existen no se tocan)
INSERT INTO companies (name_normalized, display_name)
SELECT DISTINCT ON (new_norm) new_norm, display_name
FROM (SELECT new_norm, display_name FROM renorm_public_jobs
      UNION ALL SELECT new_norm, display_name FROM renorm_jobs) r
ORDER BY new_norm, display_name
ON CONFLICT (name_normalized) DO NOTHING;

UPDATE public_jobs p SET company_normalized = r.new_norm, company_id = c.id, updated_at = now()
FROM renorm_public_jobs r JOIN companies c ON c.name_normalized = r.new_norm
WHERE p.id = r.id;

UPDATE jobs j SET company_id = c.id, updated_at = now()
FROM renorm_jobs r JOIN companies c ON c.name_normalized = r.new_norm
WHERE j.id = r.id;

-- Control: las dos columnas tienen que dar 0
SELECT
  (SELECT count(*) FROM renorm_public_jobs r JOIN public_jobs p ON p.id = r.id
    WHERE p.company_normalized <> r.new_norm) AS pool_sin_aplicar,
  (SELECT count(*) FROM renorm_jobs r JOIN jobs j ON j.id = r.id
    JOIN companies c ON c.id = j.company_id WHERE c.name_normalized <> r.new_norm) AS ofertas_sin_aplicar;

COMMIT;
`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx > -1 ? process.argv[outIdx + 1] : undefined;
  if (!out) throw new Error("uso: tsx src/renorm-companies.ts [--local] --out <archivo.sql>");
  const url = requireDatabaseUrl({ purpose: "migration" });
  const { sql, close } = createDb(url);
  try {
    console.error(`→ ${describeDatabaseUrl(url)} (solo lectura)`);
    const pool = await sql<RenormRow[]>`
      SELECT id, company_raw AS raw, company_normalized AS current
      FROM public_jobs WHERE company_raw ~* '\\m(labs|group)\\M'`;
    const jobs = await sql<RenormRow[]>`
      SELECT j.id, j.company_raw AS raw, c.name_normalized AS current
      FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
      WHERE j.company_raw ~* '\\m(labs|group)\\M'`;
    const poolChanges = changedRows(pool);
    const jobChanges = changedRows(jobs);
    writeFileSync(out, buildSql(poolChanges, jobChanges, new Date().toISOString()), "utf8");
    const newNames = new Set([...poolChanges, ...jobChanges].map((r) => r.newNorm));
    console.error(
      `Pool: ${pool.length} leídas, ${poolChanges.length} cambian · ` +
        `Ofertas de usuarios: ${jobs.length} leídas, ${jobChanges.length} cambian · ` +
        `Empresas destino: ${newNames.size}`,
    );
    console.error(`SQL escrito en ${out}. Revisalo antes de aplicarlo.`);
  } finally {
    await close();
  }
}

if (process.argv[1]?.includes("renorm-companies")) {
  main().catch((error: unknown) => {
    console.error("renorm-companies falló:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
