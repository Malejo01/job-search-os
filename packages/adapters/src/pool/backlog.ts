import { schema as s, type Db } from "@job-search-os/db";
import { assessPoolTitle, interleaveByRole, rankCandidates } from "@job-search-os/pipeline";
import { and, eq, gt, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { loadProfilePrefilterPrefs } from "../ingest/ingest-job";
import { loadActiveRules } from "../ingest/run-getonboard";
import type { Logger } from "../logger";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { poolExtraDiscard } from "./select";
import { poolPreScore } from "./usage";

/**
 * Cola diaria sobre lo asignado y todavía sin evaluar (ronda 38): elige, entre TODAS las ofertas
 * del pool del usuario con JD, en `prefiltrada`, sin evaluación y sin mensaje pendiente o en
 * proceso, las mejores `count` (rol exacto primero, después pre-score, el mismo cálculo que la
 * asignación) y las encola. Así lo asignado que no entró en la cola del día no queda huérfano.
 * Toma el mismo lock por usuario que `assignPoolToUser`. Sin modelo; logs con solo conteos.
 */
const CANDIDATE_CAP = 500;
/** Páginas máximas de la consulta de candidatas (tope duro para no colgar el cron). */
const MAX_PAGES = 10;

type Candidate = {
  id: string;
  flags: string[] | null;
  salaryMaxUsd: number | null;
  salaryPeriod: typeof s.jobs.$inferSelect.salaryPeriod;
  postedAt: Date | null;
  roleHints: string[];
  title: string;
  locationRaw: string | null;
  countriesAllowed: string[] | null;
};

export async function enqueueUnevaluated(
  db: Db,
  userId: string,
  opts: {
    count: number;
    logger: Logger;
    /** Solo para tests: tamaño de página y tope de candidatas válidas (default 500). */
    candidateCap?: number;
    maxPages?: number;
  },
): Promise<{ enqueued: number; enqueuedJobIds: string[] }> {
  const none = { enqueued: 0, enqueuedJobIds: [] as string[] };
  if (opts.count <= 0) return none;
  const cap = opts.candidateCap ?? CANDIDATE_CAP;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool-assign:${userId}`}))`);
    const rules = await loadActiveRules(tx, userId);
    if (!rules) return none;
    const prefs = await loadProfilePrefilterPrefs(tx, userId);
    const roles = prefs.targetRoles;

    const evaluated = tx
      .select({ one: sql`1` })
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, s.jobs.id));
    const inQueue = tx
      .select({ one: sql`1` })
      .from(s.jobQueue)
      .where(
        and(
          eq(s.jobQueue.queue, EVALUATE_QUEUE),
          sql`${s.jobQueue.status} in ('pending', 'processing')`,
          sql`${s.jobQueue.payload}->>'jobId' = ${s.jobs.id}::text`,
        ),
      );
    // No se encola lo que hoy la selección descartaría por país o por nivel: queda en `prefiltrada`
    // sin evaluar (no se reasigna ni se borra; solo se deja de gastar evaluaciones en eso). Como
    // esas filas se quedan ahí, se pagina por `id` (keyset) hasta juntar `cap` válidas, con un tope
    // de páginas: un lote de descartables no puede dejar la cola en 0.
    const rows: Candidate[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages && rows.length < cap; page++) {
      const batch: Candidate[] = await tx
        .select({
          id: s.jobs.id,
          flags: s.jobs.flags,
          salaryMaxUsd: s.jobs.salaryMaxUsd,
          salaryPeriod: s.jobs.salaryPeriod,
          postedAt: s.jobs.postedAt,
          roleHints: s.publicJobs.roleHints,
          title: s.jobs.title,
          locationRaw: s.jobs.locationRaw,
          countriesAllowed: s.jobs.countriesAllowed,
        })
        .from(s.jobs)
        .innerJoin(s.publicJobs, eq(s.publicJobs.id, s.jobs.publicJobId))
        .where(
          and(
            eq(s.jobs.userId, userId),
            isNotNull(s.jobs.publicJobId),
            eq(s.jobs.status, "prefiltrada"),
            sql`length(trim(coalesce(${s.jobs.jdText}, ''))) > 0`,
            notExists(evaluated),
            notExists(inQueue),
            after ? gt(s.jobs.id, after) : undefined,
          ),
        )
        .orderBy(s.jobs.id)
        .limit(cap);
      for (const r of batch) {
        if (rows.length < cap && !poolExtraDiscard(r, prefs)) rows.push(r);
      }
      if (batch.length < cap) break;
      after = batch[batch.length - 1]!.id;
    }
    if (!rows.length) return none;

    const skillRows = await tx
      .select({
        jobId: s.jobSkills.jobId,
        skillId: s.skills.id,
        slug: s.skills.slug,
        name: s.skills.name,
        isMust: s.jobSkills.isMust,
      })
      .from(s.jobSkills)
      .innerJoin(s.skills, eq(s.skills.id, s.jobSkills.skillId))
      .where(
        inArray(
          s.jobSkills.jobId,
          rows.map((r) => r.id),
        ),
      );
    const levelRows = await tx
      .select({ skillId: s.skillLevels.skillId, level: s.skillLevels.level })
      .from(s.skillLevels)
      .where(eq(s.skillLevels.userId, userId));
    const levelBySkill = new Map(levelRows.map((l) => [l.skillId, l.level]));
    const skillsByJob = new Map<string, typeof skillRows>();
    for (const r of skillRows) skillsByJob.set(r.jobId, [...(skillsByJob.get(r.jobId) ?? []), r]);

    // Mismo criterio que la asignación: rankCandidates y, entre varios puestos, intercalado
    const ranked = interleaveByRole(
      rankCandidates(
        rows.map((r) => {
          const a = assessPoolTitle({
            title: r.title,
            roleHints: r.roleHints,
            roles,
            yearsTotal: prefs.yearsTotal,
          });
          return {
            id: r.id,
            postedAt: r.postedAt,
            roleHints: a.effectiveHints,
            exactRole: a.titleFit >= 1,
            titleFit: a.titleFit as number,
            seniorPenalty: a.seniorPenalty as number,
            score: poolPreScore({
              flags: r.flags ?? [],
              skills: (skillsByJob.get(r.id) ?? []).map((k) => ({
                slug: k.slug,
                name: k.name,
                isMust: k.isMust,
                level: levelBySkill.get(k.skillId) ?? null,
              })),
              salaryMaxUsd: r.salaryMaxUsd,
              salaryPeriod: r.salaryPeriod,
              salaryFloorUsd: rules.salary_floor_usd_monthly ?? null,
            }).score,
          };
        }),
      ),
      roles,
    ).slice(0, opts.count);

    const enqueue = enqueueEvaluationWith(tx, createPgQueue(tx));
    for (const r of ranked) await enqueue(r.id, userId);
    return { enqueued: ranked.length, enqueuedJobIds: ranked.map((r) => r.id) };
  });

  opts.logger.child({ user_id: userId }).info({ enqueued: result.enqueued }, "pool: cola diaria");
  return result;
}
