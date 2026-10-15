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
import { loadProfilePrefilterPrefs } from "../ingest/ingest-job";
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
      const pre = prefilter(pj, rules, {
        userCountry: prefs.country,
        remoteOnly: prefs.remoteOnly,
        targetRoles: roles,
      });
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
