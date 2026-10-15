import { schema as s, type Db } from "@job-search-os/db";
import {
  IT_ROLE_KEYS,
  interleaveByRole,
  prefilter,
  rankCandidates,
  type CriteriaRules,
  type PrefilterReason,
  type RoleKey,
} from "@job-search-os/pipeline";
import { and, eq, gte, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { poolPreScore } from "./usage";

/**
 * Selección del pool para una persona (ronda 38, extraída en la 51): consulta de candidatas,
 * prefiltro, skills, pre-score y ranking. Solo lee: no escribe, no encola y no llama a ningún
 * modelo. La usan la asignación (`assign.ts`) y la herramienta `pool:explain`. Con `userId: null`
 * (modo persona) no se descartan las ofertas que la persona ya tiene.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Candidatas que se traen y puntúan por corrida. */
export const CANDIDATE_CAP = 300;
export const SEEN_WINDOW_DAYS = 14;
export const POSTED_WINDOW_DAYS = 30;

export type PublicJobRow = typeof s.publicJobs.$inferSelect;

export type PoolSkillRow = {
  publicJobId: string;
  skillId: string;
  slug: string;
  name: string;
  isMust: boolean;
  rawMention: string | null;
};

export type SelectInput = {
  /** null = modo persona: no se mira lo que la persona ya tiene. */
  userId: string | null;
  rules: CriteriaRules;
  prefs: {
    country: string | null;
    remoteOnly: boolean;
    targetRoles: readonly RoleKey[];
    /** Hoy no lo usa el prefiltro; lo lee la herramienta de diagnóstico. */
    yearsTotal?: number | null;
  };
  levelBySkill: ReadonlyMap<string, number>;
  now: Date;
  limit: number;
};

export type RankedPick = {
  row: PublicJobRow;
  flags: string[];
  matchedRole: RoleKey | null;
  score: number;
  exactRole: boolean;
  /** Posición (desde 1) en el orden completo de ranking. */
  rank: number;
};

export type DiscardedPick = { row: PublicJobRow; reason: PrefilterReason; detail: string };

export type PoolSelection = {
  /** Las elegidas (hasta `limit`), en orden de ranking. */
  ranked: RankedPick[];
  discarded: DiscardedPick[];
  /** Cuántas trajo la consulta (tope `CANDIDATE_CAP`). */
  candidateCount: number;
  /** Ids de la consulta, para saber si una oferta quedó antes o después del tope. */
  candidateIds: Set<string>;
  /** Ids de todas las que pasaron el prefiltro, en orden de ranking (no solo las `limit`). */
  rankedIds: string[];
  skillsByPublicJob: Map<string, PoolSkillRow[]>;
};

/** Ventanas de tiempo de la consulta, desde `now`. */
export function poolWindows(now: Date): { seenSince: Date; postedSince: Date } {
  return {
    seenSince: new Date(now.getTime() - SEEN_WINDOW_DAYS * DAY_MS),
    postedSince: new Date(now.getTime() - POSTED_WINDOW_DAYS * DAY_MS),
  };
}

/** Subconsulta: la persona ya tiene esta oferta (por pool, por URL o por hash de la JD). */
export function alreadyOwnedBy(tx: Db, userId: string) {
  return tx
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
}

export async function selectPoolCandidates(tx: Db, input: SelectInput): Promise<PoolSelection> {
  const { userId, rules, prefs, levelBySkill, now, limit } = input;
  const { seenSince, postedSince } = poolWindows(now);

  // Puestos (ADR-016): los válidos filtran; sin ninguno, solo IT
  const roles = prefs.targetRoles;
  const rolesArray = sql`ARRAY[${sql.join(
    roles.map((k) => sql`${k}`),
    sql`, `,
  )}]::text[]`;
  const itRoleKeys = sql`ARRAY[${sql.join(
    IT_ROLE_KEYS.map((k) => sql`${k}`),
    sql`, `,
  )}]::text[]`;

  // Candidatas: vivas, recientes, sin copias, del rol (o sin señal de rol) y que la persona no tiene
  const candidates = await tx
    .select()
    .from(s.publicJobs)
    .where(
      and(
        isNull(s.publicJobs.dedupOfId),
        gte(s.publicJobs.lastSeenAt, seenSince),
        or(gte(s.publicJobs.postedAt, postedSince), isNull(s.publicJobs.postedAt)),
        // Sin puesto solo IT (ADR-015): el aviso marcado solo con puestos digitales no entra
        roles.length
          ? sql`(${s.publicJobs.roleHints} && ${rolesArray} or ${s.publicJobs.roleHints} = '{}'::text[])`
          : sql`(${s.publicJobs.roleHints} = '{}'::text[] or ${s.publicJobs.roleHints} && ${itRoleKeys})`,
        userId ? notExists(alreadyOwnedBy(tx, userId)) : undefined,
      ),
    )
    // El puesto exacto (de cualquiera de los elegidos) va antes del tope: un aviso exacto más viejo
    // que 300 sin señal de rol entra igual
    .orderBy(
      ...(roles.length ? [sql`(${s.publicJobs.roleHints} && ${rolesArray}) desc`] : []),
      sql`${s.publicJobs.postedAt} desc nulls last`,
      s.publicJobs.id,
    )
    .limit(CANDIDATE_CAP);

  const candidateIds = new Set(candidates.map((c) => c.id));
  const none: PoolSelection = {
    ranked: [],
    discarded: [],
    candidateCount: candidates.length,
    candidateIds,
    rankedIds: [],
    skillsByPublicJob: new Map(),
  };
  if (!candidates.length) return none;

  // Prefiltro por candidata
  const passed: { row: PublicJobRow; flags: string[] }[] = [];
  const discarded: DiscardedPick[] = [];
  for (const pj of candidates) {
    const pre = prefilter(
      {
        title: pj.title,
        companyRaw: pj.companyRaw,
        locationRaw: pj.locationRaw,
        modality: pj.modality,
        candidatesCount: pj.candidatesCount,
        countriesAllowed: pj.countriesAllowed,
      },
      rules,
      { userCountry: prefs.country, remoteOnly: prefs.remoteOnly, targetRoles: roles },
    );
    if (!pre.pass) {
      discarded.push({ row: pj, reason: pre.reason, detail: pre.detail });
      continue;
    }
    passed.push({
      row: pj,
      flags: [...pre.flags, ...(pre.cap !== null ? [`title_cap:${pre.cap}`] : [])],
    });
  }
  if (!passed.length) return { ...none, discarded };

  // Skills de las que pasaron y pre-score
  const skillRows: PoolSkillRow[] = await tx
    .select({
      publicJobId: s.publicJobSkills.publicJobId,
      skillId: s.skills.id,
      slug: s.skills.slug,
      name: s.skills.name,
      isMust: s.publicJobSkills.isMust,
      rawMention: s.publicJobSkills.rawMention,
    })
    .from(s.publicJobSkills)
    .innerJoin(s.skills, eq(s.skills.id, s.publicJobSkills.skillId))
    .where(
      inArray(
        s.publicJobSkills.publicJobId,
        passed.map((p) => p.row.id),
      ),
    );
  const skillsByPublicJob = new Map<string, PoolSkillRow[]>();
  for (const r of skillRows) {
    skillsByPublicJob.set(r.publicJobId, [...(skillsByPublicJob.get(r.publicJobId) ?? []), r]);
  }

  // Orden de rankCandidates y, con varios puestos, intercalado entre ellos (ADR-016)
  const all = interleaveByRole(
    rankCandidates(
      passed.map((p) => ({
        ...p,
        id: p.row.id,
        postedAt: p.row.postedAt,
        roleHints: p.row.roleHints,
        exactRole: p.row.roleHints.some((h) => (roles as readonly string[]).includes(h)),
        score: poolPreScore({
          flags: p.flags,
          skills: (skillsByPublicJob.get(p.row.id) ?? []).map((k) => ({
            slug: k.slug,
            name: k.name,
            isMust: k.isMust,
            level: levelBySkill.get(k.skillId) ?? null,
          })),
          salaryMaxUsd: p.row.salaryMaxUsd,
          salaryPeriod: p.row.salaryPeriod,
          salaryFloorUsd: rules.salary_floor_usd_monthly ?? null,
        }).score,
      })),
    ),
    roles,
  );

  return {
    ranked: all.slice(0, limit).map((r, i) => ({
      row: r.row,
      flags: r.flags,
      matchedRole: r.matchedRole,
      score: r.score,
      exactRole: r.exactRole,
      rank: i + 1,
    })),
    discarded,
    candidateCount: candidates.length,
    candidateIds,
    rankedIds: all.map((r) => r.id),
    skillsByPublicJob,
  };
}
