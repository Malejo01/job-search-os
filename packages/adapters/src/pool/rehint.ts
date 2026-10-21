import { schema as s, type Db } from "@job-search-os/db";
import { detectJobLanguage, inferRoleHints, ROLE_KEYS } from "@job-search-os/pipeline";
import { and, asc, eq, gt, gte, isNull } from "drizzle-orm";
import { inReadOnlyTransaction } from "./explain";
import { poolWindows, SEEN_WINDOW_DAYS } from "./select";

/**
 * Recalcula `role_hints` y `lang` de las ofertas vigentes del pool con el código actual (ronda 102).
 * El upsert solo corrige las ofertas que vuelven a aparecer; las fuentes con ventana no devuelven
 * las viejas, así que esas no se corrigen solas. Corre con la conexión de servicio (dueña).
 *
 * Las filas vigentes son las mismas que mira `pool:explain --hints`: sin copias (`dedup_of_id`
 * nulo) y con `last_seen_at` dentro de la ventana de `poolWindows`. Con `apply`, un `UPDATE` por
 * fila que cambió, solo de `role_hints` y/o `lang`; no toca `updated_at`, `last_seen_at` ni el
 * crudo. Cada lote va en su transacción. El informe son solo conteos: ni títulos, ni ids, ni texto.
 */

export const REHINT_BATCH_SIZE = 500;
const LEGACY_HINT = "producto_proyectos";

export type RehintReport = {
  total: number;
  hintsChanged: number;
  langChanged: number;
  /** Filas que el `UPDATE` tocó de verdad (0 en el dry-run). */
  rowsWritten: number;
  /** Una fila por carrera de `ROLE_KEYS`, más la clave anterior si hay filas guardadas con ella. */
  byRoleBefore: Record<string, number>;
  byRoleAfter: Record<string, number>;
  byLangBefore: Record<string, number>;
  byLangAfter: Record<string, number>;
  /** Combinación nueva de las filas que tenían `producto_proyectos`, con cuántas filas. */
  legacyMatrix: { from: string; to: string; count: number }[];
};

const keyOf = (hints: readonly string[]) => (hints.length ? hints.join(",") : "(sin señal)");

function hintsDiffer(stored: readonly string[], next: readonly string[]): boolean {
  return JSON.stringify([...stored].sort()) !== JSON.stringify([...next].sort());
}

/** Solo códigos de dos letras; cualquier otro valor guardado se cuenta como «otro», nunca se imprime. */
function langBucket(lang: string | null): string {
  if (lang === null) return "(sin dato)";
  return /^[a-z]{2}$/.test(lang) ? lang : "otro";
}

export async function rehintPool(
  db: Db,
  opts: { apply: boolean; now: Date; batchSize?: number },
): Promise<RehintReport> {
  const batchSize = opts.batchSize ?? REHINT_BATCH_SIZE;
  const { seenSince } = poolWindows(opts.now);
  const roleBefore = new Map<string, number>();
  const roleAfter = new Map<string, number>();
  const langBefore = new Map<string, number>();
  const langAfter = new Map<string, number>();
  const matrix = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const report = { total: 0, hintsChanged: 0, langChanged: 0, rowsWritten: 0 };

  let cursor: string | null = null;
  for (;;) {
    const where = and(
      isNull(s.publicJobs.dedupOfId),
      gte(s.publicJobs.lastSeenAt, seenSince),
      cursor ? gt(s.publicJobs.id, cursor) : undefined,
    );
    const process = async (tx: Db): Promise<number> => {
      const rows = await tx
        .select({
          id: s.publicJobs.id,
          sourceKind: s.publicJobs.sourceKind,
          title: s.publicJobs.title,
          tags: s.publicJobs.tags,
          categories: s.publicJobs.categories,
          jdText: s.publicJobs.jdText,
          roleHints: s.publicJobs.roleHints,
          lang: s.publicJobs.lang,
        })
        .from(s.publicJobs)
        .where(where)
        .orderBy(asc(s.publicJobs.id))
        .limit(batchSize);
      for (const row of rows) {
        const oldHints = [...new Set(row.roleHints ?? [])];
        const nextHints = inferRoleHints({
          sourceKind: row.sourceKind,
          title: row.title,
          tags: row.tags ?? undefined,
          categories: row.categories ?? undefined,
        });
        const nextLang = detectJobLanguage(row.jdText, row.lang);
        for (const h of oldHints) bump(roleBefore, h);
        for (const h of nextHints) bump(roleAfter, h);
        bump(langBefore, langBucket(row.lang));
        bump(langAfter, langBucket(nextLang));
        if (oldHints.includes(LEGACY_HINT)) bump(matrix, keyOf(nextHints));
        const hintsChanged = hintsDiffer(row.roleHints ?? [], nextHints);
        const langChanged = (row.lang ?? null) !== nextLang;
        report.total += 1;
        if (hintsChanged) report.hintsChanged += 1;
        if (langChanged) report.langChanged += 1;
        if (opts.apply && (hintsChanged || langChanged)) {
          // Se cuentan las filas que el UPDATE tocó de verdad: con un rol sin permiso, RLS las
          // descartaría en silencio y el informe no puede decir que se escribió
          const written = await tx
            .update(s.publicJobs)
            .set({
              ...(hintsChanged ? { roleHints: nextHints } : {}),
              ...(langChanged ? { lang: nextLang } : {}),
            })
            .where(eq(s.publicJobs.id, row.id))
            .returning({ id: s.publicJobs.id });
          report.rowsWritten += written.length;
        }
      }
      cursor = rows.length ? rows[rows.length - 1]!.id : cursor;
      return rows.length;
    };
    // El dry-run corre en una transacción de solo lectura: Postgres rechaza cualquier escritura
    const n: number = opts.apply
      ? await db.transaction((tx) => process(tx as unknown as Db))
      : await inReadOnlyTransaction(db, process);
    if (n < batchSize) break;
  }

  const known: string[] = [...ROLE_KEYS, ...(roleBefore.has(LEGACY_HINT) ? [LEGACY_HINT] : [])];
  const pick = (m: Map<string, number>) => Object.fromEntries(known.map((k) => [k, m.get(k) ?? 0]));
  const sorted = (m: Map<string, number>) =>
    Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)));
  return {
    ...report,
    byRoleBefore: pick(roleBefore),
    byRoleAfter: pick(roleAfter),
    byLangBefore: sorted(langBefore),
    byLangAfter: sorted(langAfter),
    legacyMatrix: [...matrix]
      .map(([to, count]) => ({ from: LEGACY_HINT, to, count }))
      .sort((a, b) => b.count - a.count || a.to.localeCompare(b.to)),
  };
}

export function formatRehintReport(r: RehintReport): string {
  const table = (title: string, before: Record<string, number>, after: Record<string, number>) => {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const w = Math.max(title.length, ...keys.map((k) => k.length));
    const line = (a: string, b: string, c: string) =>
      `${a.padEnd(w)}  ${b.padStart(7)}  ${c.padStart(7)}`.trimEnd();
    return [
      line(title, "antes", "después"),
      ...keys.map((k) => line(k, String(before[k] ?? 0), String(after[k] ?? 0))),
    ];
  };
  return [
    `avisos vigentes (visto en los últimos ${SEEN_WINDOW_DAYS} d, sin copias): ${r.total}`,
    `role_hints a cambiar: ${r.hintsChanged}`,
    `lang a cambiar: ${r.langChanged}`,
    "",
    ...table("carrera", r.byRoleBefore, r.byRoleAfter),
    "",
    ...table("idioma", r.byLangBefore, r.byLangAfter),
    "",
    `${LEGACY_HINT} → combinación nueva:`,
    ...(r.legacyMatrix.length
      ? r.legacyMatrix.map((m) => `  ${m.to}: ${m.count}`)
      : ["  (ninguna fila guardada con esa clave)"]),
  ].join("\n");
}

/** Argumentos de `pool:rehint`: `[--apply] [--remote]`. Cualquier otra cosa es un error. */
export function parseRehintArgs(
  argv: readonly string[],
): { ok: true; apply: boolean; remote: boolean } | { ok: false; error: string } {
  let apply = false;
  let remote = false;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--remote") remote = true;
    else return { ok: false, error: "uso: pnpm pool:rehint [--apply] [--remote]" };
  }
  return { ok: true, apply, remote };
}
