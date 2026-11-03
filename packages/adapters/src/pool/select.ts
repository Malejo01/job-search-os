import { schema as s, type Db } from "@job-search-os/db";
import {
  type AcceptedModality,
  IT_ROLE_KEYS,
  MAX_JD_CHARS,
  allowsCountry,
  assessPoolTitle,
  interleaveByRole,
  locationScope,
  OUTSIDE_AREAS_FLAG,
  outsideSelectedAreas,
  prefilter,
  rankCandidates,
  isTooSenior,
  strongTitlePattern,
  type CriteriaRules,
  type PoolDiscardReason,
  type RoleKey,
  type TitleLevel,
} from "@job-search-os/pipeline";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { jdLanguageFor } from "../ingest/ingest-job";
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
/**
 * Los ATS públicos publican el aviso con la fecha de alta y lo mantienen abierto meses: para ellos
 * la ventana es `last_seen_at` (siguen vivos), no `posted_at`.
 */
export const ATS_SOURCE_KINDS = ["greenhouse", "lever", "ashby", "teamtailor"] as const;
export const isAtsSource = (kind: string): boolean =>
  (ATS_SOURCE_KINDS as readonly string[]).includes(kind);

/** Condición de la ventana de publicación (misma en la asignación y en la explicación del vacío). */
export function postedWindowCondition(postedSince: Date) {
  return or(
    inArray(s.publicJobs.sourceKind, [...ATS_SOURCE_KINDS]),
    gte(s.publicJobs.postedAt, postedSince),
    isNull(s.publicJobs.postedAt),
  );
}

export type PublicJobRow = typeof s.publicJobs.$inferSelect;

/**
 * Lo que la selección lee de cada una de las `CANDIDATE_CAP` candidatas (C6-3): lo que usan el
 * prefiltro, el título, el ranking y el pre-score. Sin la descripción completa, los shingles ni
 * `raw_ref`: `select()` traía ~70 KB por fila (~21 MB por llamada) y solo se usa la fila completa de
 * las pocas que quedan elegidas (`hydrateRows`).
 */
export type PoolCandidateRow = Pick<
  PublicJobRow,
  | "id"
  | "sourceKind"
  | "title"
  | "companyRaw"
  | "locationRaw"
  | "modality"
  | "candidatesCount"
  | "countriesAllowed"
  | "lang"
  | "roleHints"
  | "postedAt"
  | "lastSeenAt"
  | "salaryMaxUsd"
  | "salaryPeriod"
> & {
  /**
   * Texto para detectar el idioma del aviso, acotado a `MAX_JD_CHARS` (lo mismo que lee
   * `detectEnglish`). Solo viene si la persona no acepta los dos idiomas y el aviso no trae `lang`
   * en/es: en los demás casos el prefiltro no lo mira o el idioma sale de `lang`, y vale `null`.
   */
  jdForLanguage: string | null;
};

/** Filas completas que se leen por consulta cuando se hidratan las elegidas. */
export const HYDRATE_BATCH = 25;

function candidateColumns(needsLanguageText: boolean) {
  return {
    id: s.publicJobs.id,
    sourceKind: s.publicJobs.sourceKind,
    title: s.publicJobs.title,
    companyRaw: s.publicJobs.companyRaw,
    locationRaw: s.publicJobs.locationRaw,
    modality: s.publicJobs.modality,
    candidatesCount: s.publicJobs.candidatesCount,
    countriesAllowed: s.publicJobs.countriesAllowed,
    lang: s.publicJobs.lang,
    roleHints: s.publicJobs.roleHints,
    postedAt: s.publicJobs.postedAt,
    lastSeenAt: s.publicJobs.lastSeenAt,
    salaryMaxUsd: s.publicJobs.salaryMaxUsd,
    salaryPeriod: s.publicJobs.salaryPeriod,
    jdForLanguage: (needsLanguageText
      ? sql`case when lower(left(btrim(${s.publicJobs.lang}), 2)) in ('en', 'es') then null else left(${s.publicJobs.jdText}, ${MAX_JD_CHARS}) end`
      : sql`null`) as SQL<string | null>,
  };
}

/**
 * Filas completas de las elegidas, por tandas de `HYDRATE_BATCH`: la descripción completa y los
 * shingles se leen solo de las que se van a asignar. Una fila que desapareció entre las dos lecturas
 * (la retención del pool) no se devuelve.
 */
export async function hydrateRows(
  tx: Db,
  ids: readonly string[],
): Promise<Map<string, PublicJobRow>> {
  const rows = new Map<string, PublicJobRow>();
  for (let i = 0; i < ids.length; i += HYDRATE_BATCH) {
    const batch = ids.slice(i, i + HYDRATE_BATCH);
    const got = await tx.select().from(s.publicJobs).where(inArray(s.publicJobs.id, batch));
    for (const r of got) rows.set(r.id, r);
  }
  return rows;
}

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
    /** Ausentes = lo derivado de `remoteOnly` y los dos idiomas (como antes de la ronda 78). */
    acceptedModalities?: readonly AcceptedModality[];
    city?: string | null;
    jobLanguages?: readonly ("es" | "en")[];
    targetRoles: readonly RoleKey[];
    /** No lo usa el prefiltro: decide el descarte `nivel` y la penalidad de Senior/Lead (< 5 años). */
    yearsTotal?: number | null;
  };
  levelBySkill: ReadonlyMap<string, number>;
  now: Date;
  limit: number;
  /**
   * Áreas de especialidad que eligió la persona (`profiles.target_specialties`, C5-3). Solo viene con
   * `AREAS_FILTER_ENABLED=1`: lo que el título deja fuera de las áreas elegidas baja de orden y se marca con
   * `fuera_de_areas`, pero nunca se descarta. Sin esto (el default), el orden es el de siempre.
   */
  areas?: { saved: unknown } | null;
};

export type RankedPick = {
  row: PublicJobRow;
  flags: string[];
  matchedRole: RoleKey | null;
  score: number;
  exactRole: boolean;
  /** Ajuste del título al puesto (2, 1 o 0). */
  titleFit: number;
  seniorPenalty: number;
  level: TitleLevel | null;
  /** Posición (desde 1) en el orden completo de ranking. */
  rank: number;
};

export type DiscardedPick = { row: PoolCandidateRow; reason: PoolDiscardReason; detail: string };

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
  /** Fit, penalidad y score de todas las que pasaron (para explicar una posición del ranking). */
  rankInfoById: Map<string, RankInfo>;
  skillsByPublicJob: Map<string, PoolSkillRow[]>;
};

export type RankInfo = {
  titleFit: number;
  seniorPenalty: number;
  level: TitleLevel | null;
  score: number;
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

/**
 * Descartes propios del pool, después del prefiltro (que no cambia): `ubicacion` si el aviso solo
 * habilita otros países que el de la persona, `nivel` si pide Staff/Principal/Head... y la persona
 * tiene menos de 5 años. Sin país de la persona o sin años, no descarta nada.
 */
export function poolExtraDiscard(
  job: {
    title: string;
    locationRaw: string | null;
    countriesAllowed: readonly string[] | null;
  },
  prefs: { country: string | null; yearsTotal?: number | null },
): { reason: "ubicacion" | "nivel"; detail: string } | null {
  const scope = locationScope(job.locationRaw, job.countriesAllowed);
  if (!allowsCountry(scope, prefs.country) && scope.kind === "places") {
    const where = [...scope.countries, ...scope.regions].join(",");
    return { reason: "ubicacion", detail: `habilita solo ${where}, no ${prefs.country}` };
  }
  const years = prefs.yearsTotal ?? null;
  if (isTooSenior(job.title, years)) {
    return { reason: "nivel", detail: `título staff o superior con ${years} años` };
  }
  return null;
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

  const strongPattern = strongTitlePattern(roles);

  // Candidatas: vivas, recientes, sin copias, del rol (o sin señal de rol) y que la persona no tiene
  // Solo hace falta el texto para detectar el idioma si la persona no acepta los dos (jdLanguageFor)
  const needsLanguageText = Boolean(prefs.jobLanguages && prefs.jobLanguages.length < 2);
  const candidates = await tx
    .select(candidateColumns(needsLanguageText))
    .from(s.publicJobs)
    .where(
      and(
        isNull(s.publicJobs.dedupOfId),
        gte(s.publicJobs.lastSeenAt, seenSince),
        postedWindowCondition(postedSince),
        // Sin puesto solo IT (ADR-015): el aviso marcado solo con puestos digitales no entra
        roles.length
          ? sql`(${s.publicJobs.roleHints} && ${rolesArray} or ${s.publicJobs.roleHints} = '{}'::text[])`
          : sql`(${s.publicJobs.roleHints} = '{}'::text[] or ${s.publicJobs.roleHints} && ${itRoleKeys})`,
        userId ? notExists(alreadyOwnedBy(tx, userId)) : undefined,
      ),
    )
    // El puesto exacto (de cualquiera de los elegidos) va antes del tope: un aviso exacto más viejo
    // que 300 sin señal de rol entra igual. Antes, los que nombran el cargo en el título (patrón
    // fuerte, aproximado: no pliega acentos): así no los desplazan los que solo vienen por categoría
    .orderBy(
      ...(strongPattern ? [sql`(${s.publicJobs.title} ~* ${strongPattern}) desc`] : []),
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
    rankInfoById: new Map(),
    skillsByPublicJob: new Map(),
  };
  if (!candidates.length) return none;

  // Prefiltro por candidata
  const passed: { row: PoolCandidateRow; flags: string[] }[] = [];
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
        jdLanguage: prefs.jobLanguages
          ? jdLanguageFor(prefs.jobLanguages, pj.jdForLanguage, pj.lang)
          : null,
      },
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
      discarded.push({ row: pj, reason: pre.reason, detail: pre.detail });
      continue;
    }
    const extra = poolExtraDiscard(pj, prefs);
    if (extra) {
      discarded.push({ row: pj, ...extra });
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

  // Orden de rankCandidates y, con varios puestos, intercalado entre ellos (ADR-016). El título
  // veta puestos (titleFit 0): a `interleaveByRole` le llegan los hints sin los vetados, así una
  // oferta vetada cae en "sin señal" y no se intercala con las buenas.
  const all = interleaveByRole(
    rankCandidates(
      passed.map((p) => {
        const a = assessPoolTitle({
          title: p.row.title,
          roleHints: p.row.roleHints,
          roles,
          yearsTotal: prefs.yearsTotal ?? null,
        });
        const outsideAreas = input.areas
          ? outsideSelectedAreas(p.row.title, a.effectiveHints, roles, input.areas.saved)
          : false;
        return {
          ...p,
          flags: outsideAreas ? [...p.flags, OUTSIDE_AREAS_FLAG] : p.flags,
          outsideAreas,
          id: p.row.id,
          postedAt: p.row.postedAt,
          roleHints: a.effectiveHints,
          exactRole: a.titleFit >= 1,
          titleFit: a.titleFit as number,
          seniorPenalty: a.seniorPenalty as number,
          level: a.level,
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
        };
      }),
    ),
    roles,
  );

  // La fila completa (descripción, shingles, rawRef...) solo de las elegidas, por tandas
  const top = all.slice(0, limit);
  const fullRows = await hydrateRows(
    tx,
    top.map((r) => r.id),
  );
  const ranked: RankedPick[] = [];
  for (const r of top) {
    const row = fullRows.get(r.id);
    if (!row) continue;
    ranked.push({
      row,
      flags: r.flags,
      matchedRole: r.matchedRole,
      score: r.score,
      exactRole: r.exactRole,
      titleFit: r.titleFit,
      seniorPenalty: r.seniorPenalty,
      level: r.level,
      rank: ranked.length + 1,
    });
  }

  return {
    ranked,
    discarded,
    candidateCount: candidates.length,
    candidateIds,
    rankedIds: all.map((r) => r.id),
    rankInfoById: new Map(
      all.map((r) => [
        r.id,
        { titleFit: r.titleFit, seniorPenalty: r.seniorPenalty, level: r.level, score: r.score },
      ]),
    ),
    skillsByPublicJob,
  };
}
