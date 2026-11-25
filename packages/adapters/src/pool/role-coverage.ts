import { schema as s, type Db } from "@job-search-os/db";
import roleSkillsSeed from "@job-search-os/db/seeds/role_skills.json";
import {
  prefilter,
  roleSkillsSchema,
  summarizeRoleGap,
  type RoleGapSummary,
  type RoleKey,
} from "@job-search-os/pipeline";
import { and, eq, gte, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { jdLanguageFor, loadProfilePrefilterPrefs } from "../ingest/ingest-job";
import { loadActiveRules } from "../ingest/run-getonboard";
import { createLogger } from "../logger";
import { CANDIDATE_CAP, POSTED_WINDOW_DAYS, SEEN_WINDOW_DAYS } from "./assign";
import { poolExtraDiscard, postedWindowCondition } from "./select";

/**
 * Explicación del vacío por puesto (ronda 46): para cada puesto elegido sin ninguna oferta del pool
 * asignada, mira las candidatas con las mismas ventanas, filtro y prefiltro que `assignPoolToUser`
 * y resume por qué no llegaron. Solo lectura, sin modelo ni red. Los logs llevan solo conteos y
 * `user_id`.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

const ROLE_LABELS = roleSkillsSchema.parse(roleSkillsSeed);

/**
 * Cobertura del pool por carrera y por idioma (R28-06, `pnpm pool:cobertura`). UNA consulta agregada y de
 * solo lectura sobre `public_jobs` (el pool global, sin datos de personas): devuelve carrera e idioma con
 * conteos, nunca títulos, empresas ni textos. «Activa» = sin copias y vista en los últimos 30 días. Un
 * aviso con varias carreras cuenta una vez en cada una. Idioma = `coalesce(jd_language, lang)`: «es»,
 * «en», otro, o «sin dato». `db` tiene que ser una transacción de solo lectura (lo arma el CLI).
 */
export const COVERAGE_WINDOW_DAYS = 30;
/** Las celdas con menos que esto se muestran como «<5» (no se publican conteos chicos). */
export const SMALL_CELL = 5;

export type RoleLanguageRow = {
  role: string;
  es: number;
  en: number;
  other: number;
  unknown: number;
};

export async function readRoleLanguageCoverage(db: Db, now: Date): Promise<RoleLanguageRow[]> {
  const since = new Date(now.getTime() - COVERAGE_WINDOW_DAYS * DAY_MS).toISOString();
  const c = s.publicJobs;
  const lang = sql`coalesce(${c.jdLanguage}, ${c.lang})`;
  const rows = await db
    .select({
      role: sql<string>`r`,
      es: sql<number>`count(*) filter (where ${lang} = 'es')::int`,
      en: sql<number>`count(*) filter (where ${lang} = 'en')::int`,
      other: sql<number>`count(*) filter (where ${lang} is not null and ${lang} not in ('es', 'en'))::int`,
      unknown: sql<number>`count(*) filter (where ${lang} is null)::int`,
    })
    .from(sql`${c}, unnest(${c.roleHints}) as r`)
    .where(sql`${c.dedupOfId} is null and ${c.lastSeenAt} >= ${since}::timestamptz`)
    .groupBy(sql`r`)
    .orderBy(sql`r`);
  return rows.map((row) => {
    const parsed = {
      role: String(row.role),
      es: Number(row.es),
      en: Number(row.en),
      other: Number(row.other),
      unknown: Number(row.unknown),
    };
    // Falla cerrado: un conteo que no es entero no negativo es una forma inesperada
    for (const n of [parsed.es, parsed.en, parsed.other, parsed.unknown]) {
      if (!Number.isInteger(n) || n < 0) throw new Error("role-coverage: forma inesperada");
    }
    return parsed;
  });
}

/** 0 se muestra tal cual; de 1 a 4, «<5»; desde 5, el número. */
export function maskCell(n: number): string {
  if (n <= 0) return "0";
  return n < SMALL_CELL ? `<${SMALL_CELL}` : String(n);
}

export function formatRoleLanguageCoverage(
  rows: readonly RoleLanguageRow[],
  meta: { label: string; asOf: Date },
): string {
  const header = ["carrera", "total", "es", "en", "otro", "sin dato"];
  const body = rows
    .map((r) => ({ r, total: r.es + r.en + r.other + r.unknown }))
    .sort((a, b) => b.total - a.total || a.r.role.localeCompare(b.r.role))
    .map(({ r, total }) => [
      r.role,
      maskCell(total),
      maskCell(r.es),
      maskCell(r.en),
      maskCell(r.other),
      maskCell(r.unknown),
    ]);
  const table = [header, ...body];
  const widths = header.map((_, i) => Math.max(...table.map((row) => row[i]!.length)));
  const line = (row: string[]) =>
    row
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!)))
      .join("  ");
  return [
    `base: ${meta.label}`,
    `fecha: ${meta.asOf.toISOString().slice(0, 10)} · avisos activos en ${COVERAGE_WINDOW_DAYS} días, sin copias`,
    "",
    line(header),
    ...body.map(line),
    "",
    `Celdas de 1 a ${SMALL_CELL - 1} avisos: «<${SMALL_CELL}». Un aviso con varias carreras cuenta en cada una.`,
  ].join("\n");
}

export type CoverageTarget =
  { kind: "local"; db: "dev" | "snapshot" } | { kind: "remote-readonly" };

/**
 * Destino de `pool:cobertura`. Falla cerrado: sin `DB_TARGET=local` ni `--local` solo corre si se pasa
 * `--solo-lectura` explícito (la corrida de Admin contra producción). Nunca elige la nube por omisión.
 */
export function parseCoverageArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): { ok: true; target: CoverageTarget } | { ok: false; error: string } {
  const known = new Set(["--local", "--solo-lectura", "--db"]);
  let db: "dev" | "snapshot" = "dev";
  let local = env.DB_TARGET === "local";
  let readOnlyRemote = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--db") {
      const v = argv[++i];
      if (v !== "dev" && v !== "snapshot") return { ok: false, error: "--db: dev o snapshot" };
      db = v;
    } else if (a === "--local") local = true;
    else if (a === "--solo-lectura") readOnlyRemote = true;
    else if (!known.has(a)) return { ok: false, error: `argumento desconocido: ${a}` };
  }
  if (local && readOnlyRemote) {
    return {
      ok: false,
      error: "elegí uno: base local (DB_TARGET=local / --local) o --solo-lectura",
    };
  }
  if (local) return { ok: true, target: { kind: "local", db } };
  if (readOnlyRemote) return { ok: true, target: { kind: "remote-readonly" } };
  return {
    ok: false,
    error:
      "sin DB_TARGET=local ni --local no corre: la base remota exige --solo-lectura explícito (consulta agregada, solo lectura)",
  };
}

export async function explainEmptyRoles(
  db: Db,
  userId: string,
  opts: { now?: () => Date } = {},
): Promise<RoleGapSummary[]> {
  const log = createLogger({ user_id: userId, task: "role_coverage" });
  const now = opts.now?.() ?? new Date();
  const seenSince = new Date(now.getTime() - SEEN_WINDOW_DAYS * DAY_MS);
  const postedSince = new Date(now.getTime() - POSTED_WINDOW_DAYS * DAY_MS);

  const prefs = await loadProfilePrefilterPrefs(db, userId);
  const roles = prefs.targetRoles;
  if (!roles.length) return [];

  // Puestos que la persona ya cubre: algún aviso del pool asignado trae ese puesto en sus hints
  const ownedRows = await db
    .select({ roleHints: s.publicJobs.roleHints })
    .from(s.jobs)
    .innerJoin(s.publicJobs, eq(s.publicJobs.id, s.jobs.publicJobId))
    .where(and(eq(s.jobs.userId, userId), isNotNull(s.jobs.publicJobId)));
  const covered = new Set<string>(ownedRows.flatMap((r) => r.roleHints ?? []));
  const empty = roles.filter((r) => !covered.has(r));
  if (!empty.length) return [];

  const rules = await loadActiveRules(db, userId);
  // Sin criterios no hay prefiltro posible: la asignación tampoco corre; no hay nada que explicar
  if (!rules) return [];

  // Las que la persona ya tiene (por puesto, URL o contenido) no cuentan
  const alreadyOwned = db
    .select({ one: sql`1` })
    .from(s.jobs)
    .where(
      and(
        eq(s.jobs.userId, userId),
        or(
          eq(s.jobs.publicJobId, s.publicJobs.id),
          and(
            isNotNull(s.publicJobs.canonicalUrl),
            eq(s.jobs.canonicalUrl, s.publicJobs.canonicalUrl),
          ),
          and(isNotNull(s.publicJobs.jdHash), eq(s.jobs.jdHash, s.publicJobs.jdHash)),
        ),
      ),
    );

  const out: RoleGapSummary[] = [];
  for (const role of empty as RoleKey[]) {
    // Solo los avisos que traen el puesto en `role_hints`: los que no tienen hints (`'{}'`), que la
    // asignación sí admite, no son "de ese puesto" y no cuentan para el diagnóstico. El tope también
    // difiere: acá son CANDIDATE_CAP por puesto; en assign.ts, globales para todos los puestos.
    const candidates = await db
      .select({
        title: s.publicJobs.title,
        companyRaw: s.publicJobs.companyRaw,
        locationRaw: s.publicJobs.locationRaw,
        modality: s.publicJobs.modality,
        candidatesCount: s.publicJobs.candidatesCount,
        countriesAllowed: s.publicJobs.countriesAllowed,
        jdText: s.publicJobs.jdText,
        lang: s.publicJobs.lang,
      })
      .from(s.publicJobs)
      .where(
        and(
          isNull(s.publicJobs.dedupOfId),
          gte(s.publicJobs.lastSeenAt, seenSince),
          postedWindowCondition(postedSince),
          sql`${s.publicJobs.roleHints} && ARRAY[${role}]::text[]`,
          notExists(alreadyOwned),
        ),
      )
      .orderBy(sql`${s.publicJobs.postedAt} desc nulls last`, s.publicJobs.id)
      .limit(CANDIDATE_CAP);

    const discards: { reason: string; detail: string }[] = [];
    let pendingCount = 0;
    for (const pj of candidates) {
      const pre = prefilter(
        { ...pj, jdLanguage: jdLanguageFor(prefs.jobLanguages, pj.jdText, pj.lang) },
        rules,
        {
          userCountry: prefs.country,
          remoteOnly: prefs.remoteOnly,
          acceptedModalities: prefs.acceptedModalities,
          userCity: prefs.city,
          jobLanguages: prefs.jobLanguages,
          targetRoles: roles,
        },
      );
      if (!pre.pass) {
        discards.push({ reason: pre.reason, detail: pre.detail });
        continue;
      }
      // Mismos descartes propios del pool que la selección: país y nivel
      const extra = poolExtraDiscard(pj, prefs);
      if (extra) discards.push(extra);
      else pendingCount++;
    }
    out.push(
      summarizeRoleGap({
        role,
        label: ROLE_LABELS[role].label,
        poolCount: candidates.length,
        discards,
        pendingCount,
      }),
    );
  }
  log.info(
    { empty_roles: out.length, pool: out.reduce((n, g) => n + g.total, 0) },
    "pool: puestos sin ofertas explicados",
  );
  return out;
}
