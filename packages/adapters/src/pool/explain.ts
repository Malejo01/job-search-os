import { schema as s, type Db } from "@job-search-os/db";
import {
  criteriaFromOnboarding,
  inferRoleHints,
  IT_ROLE_KEYS,
  isRoleKey,
  isValidCountry,
  POOL_LIMIT_DEFAULTS,
  ROLE_KEYS,
  type AcceptedModality,
  type CriteriaRules,
  type RoleKey,
} from "@job-search-os/pipeline";
import { and, desc, eq, exists, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { loadProfilePrefilterPrefs } from "../ingest/ingest-job";
import { loadActiveRules } from "../ingest/run-getonboard";
import {
  alreadyOwnedBy,
  CANDIDATE_CAP,
  poolWindows,
  isAtsSource,
  POSTED_WINDOW_DAYS,
  SEEN_WINDOW_DAYS,
  selectPoolCandidates,
  type PoolSelection,
  type RankedPick,
  type RankInfo,
} from "./select";

/**
 * Diagnóstico del pool (ronda 51): qué ofertas elegiría hoy la asignación inicial para un perfil, en
 * qué orden y por qué una oferta concreta no entró. Solo lectura, sin LLM, sin cola, sin red.
 * Lo que es puro (argumentos, URL, persona, clasificación, formato) se prueba con unit tests; lo que
 * toca la base (`runExplain`) recibe la transacción y la deja en `READ ONLY`.
 */

export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 200;
export const WHY_MAX_MATCHES = 20;
export const TITLE_WIDTH = 60;
export const LOCATION_WIDTH = 40;

export type ExplainDb = "snapshot" | "dev";

export type ExplainArgs = {
  mode: { kind: "persona"; path: string } | { kind: "user"; userId: string } | { kind: "hints" };
  limit: number;
  db: ExplainDb;
  why: string[];
};

const KNOWN_FLAGS: readonly string[] = ["--persona", "--user", "--limit", "--db", "--why"];
/** Flags sin valor. */
const BOOLEAN_FLAGS: readonly string[] = ["--hints"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseExplainArgs(
  argv: readonly string[],
): { ok: true; args: ExplainArgs } | { ok: false; error: string } {
  let persona: string | null = null;
  let user: string | null = null;
  let limit = DEFAULT_LIMIT;
  let db: ExplainDb = "snapshot";
  const why: string[] = [];
  let hints = false;
  const list = argv.filter((a) => a !== "--");
  for (let i = 0; i < list.length; i++) {
    const flag = list[i]!;
    const value = list[i + 1];
    if (BOOLEAN_FLAGS.includes(flag)) {
      hints = true;
      continue;
    }
    if (!KNOWN_FLAGS.includes(flag)) return { ok: false, error: `argumento desconocido: ${flag}` };
    if (value === undefined || value.startsWith("--")) {
      return { ok: false, error: `${flag} necesita un valor` };
    }
    i++;
    if (flag === "--persona") persona = value;
    else if (flag === "--user") user = value;
    else if (flag === "--limit") {
      const n = /^\d{1,4}$/.test(value) ? Number(value) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        return { ok: false, error: `--limit debe ser un entero entre 1 y ${MAX_LIMIT}` };
      }
      limit = n;
    } else if (flag === "--db") {
      if (value !== "snapshot" && value !== "dev") {
        return { ok: false, error: "--db debe ser snapshot o dev" };
      }
      db = value;
    } else {
      why.push(value);
    }
  }
  if (hints) {
    if (persona !== null || user !== null || why.length) {
      return { ok: false, error: "--hints no se combina con --persona, --user ni --why" };
    }
    return { ok: true, args: { mode: { kind: "hints" }, limit, db, why } };
  }
  if ((persona === null) === (user === null)) {
    return {
      ok: false,
      error: "indicá exactamente uno: --persona <ruta.json>, --user <uuid> o --hints",
    };
  }
  if (user !== null && !UUID.test(user)) return { ok: false, error: "--user no es un uuid" };
  return {
    ok: true,
    args: {
      mode: persona !== null ? { kind: "persona", path: persona } : { kind: "user", userId: user! },
      limit,
      db,
      why,
    },
  };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * URL de la base local a partir de `LOCAL_DATABASE_URL` (se le pasa como `base`): solo cambia el
 * nombre de la base. Falla cerrado ante cualquier host que no sea localhost/127.0.0.1. No mira
 * `DATABASE_URL` ni ninguna otra variable.
 */
export function explainDatabaseUrl(
  base: string,
  db: ExplainDb,
): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return { ok: false, error: "la URL de la base local no es válida" };
  }
  if (!LOCAL_HOSTS.has(u.hostname)) {
    return { ok: false, error: "pool:explain solo se conecta a localhost: host rechazado" };
  }
  u.pathname = `/${db === "dev" ? "jobsearch" : "jobsearch_snapshot"}`;
  // Sin parámetros: nada de `host=`, `options=` u otros que cambien el destino
  u.search = "";
  u.hash = "";
  return { ok: true, url: u.toString() };
}

const personaSchema = z
  .object({
    targetRoles: z
      .array(z.string())
      .min(1)
      .refine((v) => v.every(isRoleKey), "puesto desconocido"),
    locationCountry: z.string().trim().toUpperCase().refine(isValidCountry, "país inválido"),
    remoteOnly: z.boolean(),
    yearsTotal: z.number().min(0).max(60),
    salaryFloorUsd: z.number().int().min(0).nullable().optional(),
    maxWeeklyHours: z.number().int().min(1).max(80).nullable().optional(),
    skills: z
      .array(z.object({ slug: z.string().min(1), level: z.number().int().min(0).max(3) }))
      .default([]),
  })
  .strict();

export type Persona = {
  targetRoles: RoleKey[];
  locationCountry: string;
  remoteOnly: boolean;
  yearsTotal: number;
  salaryFloorUsd: number | null;
  maxWeeklyHours: number | null;
  skills: { slug: string; level: number }[];
};

export function parsePersona(
  json: unknown,
): { ok: true; persona: Persona } | { ok: false; error: string } {
  const r = personaSchema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    return {
      ok: false,
      error: `persona inválida: ${first?.path.join(".") ?? ""} ${first?.message ?? ""}`.trim(),
    };
  }
  const p = r.data;
  return {
    ok: true,
    persona: {
      targetRoles: p.targetRoles.filter(isRoleKey),
      locationCountry: p.locationCountry,
      remoteOnly: p.remoteOnly,
      yearsTotal: p.yearsTotal,
      salaryFloorUsd: p.salaryFloorUsd ?? null,
      maxWeeklyHours: p.maxWeeklyHours ?? null,
      skills: p.skills,
    },
  };
}

/** Paso en el que una oferta quedó afuera (o `entro`). */
export type WhyStep =
  | "copia"
  | "last_seen"
  | "posted"
  | "hints"
  | "ya_la_tiene"
  | "tope"
  | "prefiltro"
  | "ubicacion"
  | "nivel"
  | "ranking"
  | "entro"
  | "sin_clasificar";

export type WhyRow = {
  dedupOfId: string | null;
  lastSeenAt: Date;
  postedAt: Date | null;
  roleHints: readonly string[];
  /** Los ATS (greenhouse, lever, ashby) no tienen ventana por `posted_at`. */
  sourceKind?: string;
};

export type WhyContext = {
  roles: readonly RoleKey[];
  now: Date;
  limit: number;
  /** Solo modo `--user`: la persona ya tiene esta oferta. */
  owned: boolean;
  inCandidates: boolean;
  discarded: { reason: string; detail: string } | null;
  /** Posición (desde 1) en el orden completo de ranking; null si no pasó el prefiltro. */
  rank: number | null;
  /** Ajuste del título, penalidad y score de la oferta, para explicar el ranking. */
  rankInfo?: RankInfo | null;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Los hints cruzan el puesto: misma regla que la consulta de candidatas de `select.ts`. */
export function hintsCrossRoles(hints: readonly string[], roles: readonly RoleKey[]): boolean {
  if (hints.length === 0) return true;
  const wanted: readonly string[] = roles.length ? roles : IT_ROLE_KEYS;
  return hints.some((h) => wanted.includes(h));
}

/** Recorre los pasos de la asignación en orden y dice en cuál quedó la oferta. */
export function classifyWhy(row: WhyRow, ctx: WhyContext): { step: WhyStep; text: string } {
  const { seenSince, postedSince } = poolWindows(ctx.now);
  if (row.dedupOfId) return { step: "copia", text: "es copia de otra fila (dedup_of_id)" };
  if (row.lastSeenAt < seenSince) {
    return {
      step: "last_seen",
      text: `last_seen_at fuera de ${SEEN_WINDOW_DAYS} d (${day(row.lastSeenAt)})`,
    };
  }
  if (row.postedAt && row.postedAt < postedSince && !isAtsSource(row.sourceKind ?? "")) {
    return {
      step: "posted",
      text: `posted_at fuera de ${POSTED_WINDOW_DAYS} d (${day(row.postedAt)})`,
    };
  }
  if (!hintsCrossRoles(row.roleHints, ctx.roles)) {
    return {
      step: "hints",
      text: `hints [${row.roleHints.join(",")}] no cruzan el puesto [${ctx.roles.join(",") || "solo IT"}]`,
    };
  }
  if (ctx.owned) return { step: "ya_la_tiene", text: "la cuenta ya tiene esta oferta" };
  if (!ctx.inCandidates) {
    return { step: "tope", text: `quedó después del tope de ${CANDIDATE_CAP} candidatas` };
  }
  if (ctx.discarded) {
    if (ctx.discarded.reason === "ubicacion" || ctx.discarded.reason === "nivel") {
      return {
        step: ctx.discarded.reason,
        text: `${ctx.discarded.reason}: ${ctx.discarded.detail}`,
      };
    }
    return {
      step: "prefiltro",
      text: `prefiltro: ${ctx.discarded.reason} (${ctx.discarded.detail})`,
    };
  }
  if (ctx.rank === null) return { step: "sin_clasificar", text: "no se pudo clasificar" };
  if (ctx.rank > ctx.limit) {
    const i = ctx.rankInfo;
    const detail = i
      ? ` (fit ${i.titleFit}, nivel ${i.level ?? "-"}${i.seniorPenalty ? " penalizado" : ""}, score ${i.score.toFixed(1)})`
      : "";
    return {
      step: "ranking",
      text: `ranking: posición ${ctx.rank} > límite ${ctx.limit}${detail}`,
    };
  }
  return { step: "entro", text: `ENTRÓ en la posición ${ctx.rank}` };
}

export type WhyMatch = { title: string; source: string; step: WhyStep; text: string };
export type WhyResult = { pattern: string; matches: WhyMatch[]; error?: string };

export type ExplainReport = {
  header: string;
  warnings: string[];
  limit: number;
  candidateCount: number;
  discardedByReason: [string, number][];
  picks: RankedPick[];
  /** Cuántas de las elegidas tienen JD (para marcar las que irían primero al LLM). */
  firstEvalTopN: number;
  why: WhyResult[];
};

const oneLine = (v: string | null | undefined, width: number) =>
  (v ?? "").replace(/\s+/g, " ").trim().slice(0, width);

const hasJd = (p: RankedPick) => Boolean(p.row.jdText?.trim());

/** Rangos de las elegidas que irían primero al LLM: las primeras `n` con JD, en orden de ranking. */
export function firstToLlm(picks: readonly RankedPick[], n: number): number[] {
  return picks
    .filter(hasJd)
    .slice(0, n)
    .map((p) => p.rank);
}

export function formatPicksTable(picks: readonly RankedPick[]): string[] {
  const head = [
    "rank",
    "fuente",
    "título",
    "ubicación",
    "hints",
    "exacto",
    "fit",
    "nivel",
    "score",
    "flags",
    "JD",
  ];
  const rows = picks.map((p) => [
    String(p.rank),
    p.row.sourceKind,
    oneLine(p.row.title, TITLE_WIDTH),
    oneLine(p.row.locationRaw, LOCATION_WIDTH),
    p.row.roleHints.join(",") || "-",
    p.exactRole ? "sí" : "no",
    String(p.titleFit),
    p.level ? `${p.level}${p.seniorPenalty ? "*" : ""}` : "-",
    p.score.toFixed(1),
    p.flags.join(",") || "-",
    hasJd(p) ? "sí" : "no",
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join("  ")
      .trimEnd();
  return [line(head), ...rows.map(line)];
}

export function formatExplainReport(r: ExplainReport): string {
  const out: string[] = [r.header, ...r.warnings.map((w) => `aviso: ${w}`)];
  out.push(`candidatas de la consulta: ${r.candidateCount} (tope ${CANDIDATE_CAP})`);
  out.push(
    r.discardedByReason.length
      ? `descartadas por el prefiltro: ${r.discardedByReason.map(([k, n]) => `${k}=${n}`).join(", ")}`
      : "descartadas por el prefiltro: ninguna",
  );
  out.push("", `elegidas (${r.picks.length} de ${r.limit}):`);
  out.push(...(r.picks.length ? formatPicksTable(r.picks) : ["(ninguna)"]));
  const first = firstToLlm(r.picks, r.firstEvalTopN);
  out.push(
    "",
    `irían primero al LLM (las ${r.firstEvalTopN} primeras con JD): ${first.length ? first.map((n) => `#${n}`).join(", ") : "ninguna"}`,
  );
  for (const w of r.why) {
    out.push("", `--why "${w.pattern}":`);
    if (w.error) out.push(`  ${w.error}`);
    else if (!w.matches.length) out.push("  ningún título coincide");
    for (const m of w.matches) {
      out.push(`  [${m.step}] ${oneLine(m.title, TITLE_WIDTH)} (${m.source}): ${m.text}`);
    }
  }
  return out.join("\n");
}

/** Conteo por razón de descarte, de mayor a menor. */
export function countByReason(discarded: PoolSelection["discarded"]): [string, number][] {
  const counts = new Map<string, number>();
  for (const d of discarded) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Corre `fn` en una transacción de solo lectura: la primera sentencia es `SET TRANSACTION READ ONLY`,
 * así que cualquier escritura posterior la rechaza Postgres.
 */
export async function inReadOnlyTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return fn(tx);
  });
}

type Profile = {
  header: string;
  warnings: string[];
  userId: string | null;
  rules: CriteriaRules;
  prefs: {
    country: string | null;
    remoteOnly: boolean;
    /** Solo las cuentas existentes los traen; la persona de prueba usa lo derivado de `remoteOnly`. */
    acceptedModalities?: readonly AcceptedModality[];
    city?: string | null;
    jobLanguages?: readonly ("es" | "en")[];
    targetRoles: RoleKey[];
    yearsTotal: number | null;
  };
  levelBySkill: Map<string, number>;
};

const describeProfile = (who: string, prefs: Profile["prefs"]): string =>
  `perfil: ${who} · puestos: ${prefs.targetRoles.join(", ") || "(ninguno: solo IT)"} · país ${prefs.country ?? "?"} · ${prefs.acceptedModalities ? `modalidades: ${prefs.acceptedModalities.join("/")}` : prefs.remoteOnly ? "solo remoto" : "cualquier modalidad"} · años: ${prefs.yearsTotal ?? "?"}`;

async function personaProfile(tx: Db, persona: Persona, label: string): Promise<Profile> {
  const slugs = persona.skills.map((k) => k.slug);
  const rows = slugs.length
    ? await tx
        .select({ id: s.skills.id, slug: s.skills.slug })
        .from(s.skills)
        .where(inArray(s.skills.slug, slugs))
    : [];
  const idBySlug = new Map(rows.map((r) => [r.slug, r.id]));
  const warnings: string[] = [];
  const levelBySkill = new Map<string, number>();
  for (const k of persona.skills) {
    const id = idBySlug.get(k.slug);
    if (id) levelBySkill.set(id, k.level);
    else warnings.push(`skill desconocida en la taxonomía: ${k.slug}`);
  }
  const prefs = {
    country: persona.locationCountry,
    remoteOnly: persona.remoteOnly,
    targetRoles: persona.targetRoles,
    yearsTotal: persona.yearsTotal,
  };
  return {
    header: describeProfile(`persona ${label}`, prefs),
    warnings,
    userId: null,
    rules: criteriaFromOnboarding({
      salaryFloorUsd: persona.salaryFloorUsd,
      maxWeeklyHours: persona.maxWeeklyHours,
    }),
    prefs,
    levelBySkill,
  };
}

async function userProfile(tx: Db, userId: string): Promise<Profile> {
  // El snapshot copia `profiles` sin filas: sin perfil o sin criterios, falla con un mensaje claro
  const [exists] = await tx
    .select({ userId: s.profiles.userId })
    .from(s.profiles)
    .where(eq(s.profiles.userId, userId))
    .limit(1);
  if (!exists) throw new Error("perfil sin datos en esta base; usá --persona");
  const rules = await loadActiveRules(tx, userId);
  if (!rules) throw new Error("criterios activos sin datos en esta base; usá --persona");
  const base = await loadProfilePrefilterPrefs(tx, userId);
  const levelRows = await tx
    .select({ skillId: s.skillLevels.skillId, level: s.skillLevels.level })
    .from(s.skillLevels)
    .where(eq(s.skillLevels.userId, userId));
  const prefs = base;
  return {
    // El user_id no se imprime
    header: describeProfile("cuenta existente", prefs),
    warnings: [],
    userId,
    rules,
    prefs,
    levelBySkill: new Map(levelRows.map((l) => [l.skillId, l.level])),
  };
}

async function explainWhy(
  tx: Db,
  pattern: string,
  profile: Profile,
  selection: PoolSelection,
  limit: number,
  now: Date,
): Promise<WhyResult> {
  try {
    new RegExp(pattern);
  } catch {
    return { pattern, matches: [], error: "la expresión regular no es válida" };
  }
  const rows = await tx
    .select()
    .from(s.publicJobs)
    .where(sql`${s.publicJobs.title} ~* ${pattern}`)
    .orderBy(sql`${s.publicJobs.postedAt} desc nulls last`, desc(s.publicJobs.id))
    .limit(WHY_MAX_MATCHES);
  const owned = new Set<string>();
  if (profile.userId && rows.length) {
    const ownedRows = await tx
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(
        and(
          inArray(
            s.publicJobs.id,
            rows.map((r) => r.id),
          ),
          exists(alreadyOwnedBy(tx, profile.userId)),
        ),
      );
    for (const o of ownedRows) owned.add(o.id);
  }
  const rankOf = new Map(selection.rankedIds.map((id, i) => [id, i + 1]));
  const discardedOf = new Map(selection.discarded.map((d) => [d.row.id, d]));
  return {
    pattern,
    matches: rows.map((row) => {
      const d = discardedOf.get(row.id);
      const { step, text } = classifyWhy(row, {
        roles: profile.prefs.targetRoles,
        now,
        limit,
        owned: owned.has(row.id),
        inCandidates: selection.candidateIds.has(row.id),
        discarded: d ? { reason: d.reason, detail: d.detail } : null,
        rank: rankOf.get(row.id) ?? null,
        rankInfo: selection.rankInfoById.get(row.id) ?? null,
      });
      return { title: row.title, source: row.sourceKind, step, text };
    }),
  };
}

/** Lo que `--hints` necesita de una fila del pool: título, categorías y tags guardados y los hints guardados. */
export type HintsRow = {
  sourceKind: string;
  title: string;
  tags: readonly string[] | null;
  categories: readonly string[] | null;
  roleHints: readonly string[] | null;
};

/** Solo conteos: ningún título, empresa ni texto de aviso. */
export type HintsReport = {
  total: number;
  /** Una fila por carrera (las de `ROLE_KEYS` y cualquier otra clave guardada, como la anterior). */
  byRole: { role: string; stored: number; recomputed: number }[];
  /** Hints guardados que incluían una clave que ya no existe → combinación nueva, con cuántas filas. */
  legacyMatrix: { from: string; to: string; count: number }[];
};

const LEGACY_HINT = "producto_proyectos";
const keyOf = (hints: readonly string[]) => (hints.length ? hints.join(",") : "(sin señal)");

/** Recalcula `inferRoleHints` con el código actual sobre filas ya leídas. Puro. */
export function buildHintsReport(rows: readonly HintsRow[]): HintsReport {
  const stored = new Map<string, number>();
  const recomputed = new Map<string, number>();
  const matrix = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const row of rows) {
    const old = [...new Set(row.roleHints ?? [])];
    const next = inferRoleHints({
      sourceKind: row.sourceKind,
      title: row.title,
      tags: row.tags ?? undefined,
      categories: row.categories ?? undefined,
    });
    for (const h of old) bump(stored, h);
    for (const h of next) bump(recomputed, h);
    if (old.includes(LEGACY_HINT)) bump(matrix, keyOf(next));
  }
  const extra = [...stored.keys()].filter((k) => !isRoleKey(k)).sort();
  return {
    total: rows.length,
    byRole: [...ROLE_KEYS, ...extra].map((role) => ({
      role,
      stored: stored.get(role) ?? 0,
      recomputed: recomputed.get(role) ?? 0,
    })),
    legacyMatrix: [...matrix]
      .map(([to, count]) => ({ from: LEGACY_HINT, to, count }))
      .sort((a, b) => b.count - a.count || a.to.localeCompare(b.to)),
  };
}

export function formatHintsReport(r: HintsReport): string {
  const widths = [
    Math.max("carrera".length, ...r.byRole.map((x) => x.role.length)),
    "guardado".length,
    "recalculado".length,
  ];
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[0]!) : c.padStart(widths[i]!)))
      .join("  ")
      .trimEnd();
  const out = [
    `avisos vigentes (visto en los últimos ${SEEN_WINDOW_DAYS} d, sin copias): ${r.total}`,
    "",
    line(["carrera", "guardado", "recalculado"]),
    ...r.byRole.map((x) => line([x.role, String(x.stored), String(x.recomputed)])),
    "",
    `${LEGACY_HINT} → combinación nueva:`,
  ];
  out.push(
    ...(r.legacyMatrix.length
      ? r.legacyMatrix.map((m) => `  ${m.to}: ${m.count}`)
      : ["  (ninguna fila guardada con esa clave)"]),
  );
  return out.join("\n");
}

/** `--hints`: recalcula los hints de la ventana con el código de la rama. Solo lectura. */
export async function runHintsReport(db: Db, deps: { now: Date }): Promise<HintsReport> {
  return inReadOnlyTransaction(db, async (tx) => {
    const { seenSince } = poolWindows(deps.now);
    const rows = await tx
      .select({
        sourceKind: s.publicJobs.sourceKind,
        title: s.publicJobs.title,
        tags: s.publicJobs.tags,
        categories: s.publicJobs.categories,
        roleHints: s.publicJobs.roleHints,
      })
      .from(s.publicJobs)
      .where(and(isNull(s.publicJobs.dedupOfId), gte(s.publicJobs.lastSeenAt, seenSince)));
    return buildHintsReport(rows);
  });
}

/** Corre el diagnóstico completo dentro de una transacción de solo lectura. */
export async function runExplain(
  db: Db,
  args: ExplainArgs,
  deps: { persona: Persona | null; personaLabel: string; now: Date },
): Promise<ExplainReport> {
  return inReadOnlyTransaction(db, async (tx) => {
    if (args.mode.kind === "hints") throw new Error("--hints usa runHintsReport");
    if (args.mode.kind === "persona" && !deps.persona) throw new Error("falta la persona");
    const profile =
      args.mode.kind === "user"
        ? await userProfile(tx, args.mode.userId)
        : await personaProfile(tx, deps.persona!, deps.personaLabel);
    const selection = await selectPoolCandidates(tx, {
      userId: profile.userId,
      rules: profile.rules,
      prefs: profile.prefs,
      levelBySkill: profile.levelBySkill,
      now: deps.now,
      limit: args.limit,
    });
    const why: WhyResult[] = [];
    for (const pattern of args.why) {
      why.push(await explainWhy(tx, pattern, profile, selection, args.limit, deps.now));
    }
    return {
      header: profile.header,
      warnings: profile.warnings,
      limit: args.limit,
      candidateCount: selection.candidateCount,
      discardedByReason: countByReason(selection.discarded),
      picks: selection.ranked,
      firstEvalTopN: POOL_LIMIT_DEFAULTS.firstEvalTopN,
      why,
    };
  });
}
