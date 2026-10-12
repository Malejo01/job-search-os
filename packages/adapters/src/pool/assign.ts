import { schema as s, type Db } from "@job-search-os/db";
import {
  IT_ROLE_KEYS,
  isRoleKey,
  prefilter,
  rankCandidates,
  type JobStatus,
} from "@job-search-os/pipeline";
import { and, eq, gte, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { loadActiveRules } from "../ingest/run-getonboard";
import { loadProfilePrefilterPrefs, upsertCompany } from "../ingest/ingest-job";
import type { Logger } from "../logger";
import { createPgQueue, enqueueEvaluationWith } from "../queue/pg-queue";
import { countPoolAssigned, countPoolQueued, poolPreScore } from "./usage";

/**
 * Asignación del pool a un usuario (ronda 38, ADR-014): copia ofertas de `public_jobs` a `jobs`
 * (con `job_sources` y `job_skills`) según el rol y los criterios de la persona. No llama a ningún
 * modelo: asigna y, para las primeras con JD, encola la evaluación. Corre con la conexión de
 * servicio, filtra por `user_id` explícito y toma un lock por usuario para que dos corridas
 * simultáneas (onboarding y cron) no dupliquen. Los logs llevan solo conteos y `user_id`.
 *
 * Los `role_hints` que se usan son los guardados en `public_jobs`: las filas ya existentes
 * conservan los suyos (sin la regla de más de 4 roles = sin señal) hasta el próximo upsert del pool
 * que las cambie.
 */
export type AssignResult = {
  /** Ofertas nuevas creadas en `jobs`. */
  assigned: number;
  /** Candidatas que el prefiltro descartó (no se crea nada). */
  discarded: number;
  /** Elegidas que el usuario ya tenía (índice único por pool o por URL). */
  alreadyHad: number;
  enqueued: number;
  /** Ids de `jobs` encolados, en orden de ranking. */
  enqueuedJobIds: string[];
};

export type AssignOptions = {
  /** Máximo de ofertas a crear. */
  limit: number;
  /** De las asignadas, cuántas (con JD, en orden) se encolan para evaluar. */
  enqueueTop: number;
  /**
   * Descuenta de `limit` y `enqueueTop`, dentro del lock, lo ya asignado y lo ya encolado del pool
   * en las últimas 24 h (los mismos contadores que la asignación diaria). Para la primera
   * asignación del onboarding: dos envíos paralelos no asignan ni encolan el doble.
   */
  deductLast24h?: boolean;
  logger: Logger;
  now?: () => Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Candidatas que se traen y puntúan por corrida. */
const CANDIDATE_CAP = 300;
const SEEN_WINDOW_DAYS = 14;
const POSTED_WINDOW_DAYS = 30;

const empty = (): AssignResult => ({
  assigned: 0,
  discarded: 0,
  alreadyHad: 0,
  enqueued: 0,
  enqueuedJobIds: [],
});

export async function assignPoolToUser(
  db: Db,
  userId: string,
  opts: AssignOptions,
): Promise<AssignResult> {
  const log = opts.logger.child({ user_id: userId });
  if (opts.limit <= 0) return empty();
  const now = opts.now?.() ?? new Date();
  const seenSince = new Date(now.getTime() - SEEN_WINDOW_DAYS * DAY_MS);
  const postedSince = new Date(now.getTime() - POSTED_WINDOW_DAYS * DAY_MS);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool-assign:${userId}`}))`);

    // Topes efectivos. Con `deductLast24h` se descuenta, dentro del lock, lo ya asignado y lo ya
    // encolado en las últimas 24 h: dos envíos paralelos del onboarding no suman el doble.
    let limit = opts.limit;
    let enqueueTop = opts.enqueueTop;
    if (opts.deductLast24h) {
      const since = new Date(now.getTime() - DAY_MS);
      limit = Math.max(0, limit - (await countPoolAssigned(tx, userId, since)));
      enqueueTop = Math.max(0, enqueueTop - (await countPoolQueued(tx, userId, since)));
      if (limit === 0) return empty();
    }

    // 1. Perfil y criterios: sin criterios no hay prefiltro posible, no se asigna nada
    const rules = await loadActiveRules(tx, userId);
    if (!rules) return empty();
    const prefs = await loadProfilePrefilterPrefs(tx, userId);
    const [profile] = await tx
      .select({ targetRole: s.profiles.targetRole })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);

    // 2. Rol: válido filtra; si no, sin filtro de rol
    const role = isRoleKey(profile?.targetRole) ? profile.targetRole : null;

    // 3. Candidatas: vivas, recientes, sin copias, del rol (o sin señal de rol) y que la persona no tiene
    const alreadyOwned = tx
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
    const itRoleKeys = sql`ARRAY[${sql.join(
      IT_ROLE_KEYS.map((k) => sql`${k}`),
      sql`, `,
    )}]::text[]`;
    const candidates = await tx
      .select()
      .from(s.publicJobs)
      .where(
        and(
          isNull(s.publicJobs.dedupOfId),
          gte(s.publicJobs.lastSeenAt, seenSince),
          or(gte(s.publicJobs.postedAt, postedSince), isNull(s.publicJobs.postedAt)),
          // Sin puesto solo IT (ADR-015): el aviso marcado solo con puestos digitales no entra
          role
            ? sql`(${s.publicJobs.roleHints} && ARRAY[${role}]::text[] or ${s.publicJobs.roleHints} = '{}'::text[])`
            : sql`(${s.publicJobs.roleHints} = '{}'::text[] or ${s.publicJobs.roleHints} && ${itRoleKeys})`,
          notExists(alreadyOwned),
        ),
      )
      // El rol exacto va antes del tope: un aviso exacto más viejo que 300 sin señal de rol entra igual
      .orderBy(
        ...(role ? [sql`(${s.publicJobs.roleHints} && ARRAY[${role}]::text[]) desc`] : []),
        sql`${s.publicJobs.postedAt} desc nulls last`,
        s.publicJobs.id,
      )
      .limit(CANDIDATE_CAP);
    if (!candidates.length) return empty();

    // 4. Prefiltro y pre-score por candidata
    const passed: { row: (typeof candidates)[number]; flags: string[] }[] = [];
    let discarded = 0;
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
        { userCountry: prefs.country, remoteOnly: prefs.remoteOnly, targetRole: role },
      );
      if (!pre.pass) {
        discarded++;
        continue;
      }
      passed.push({
        row: pj,
        flags: [...pre.flags, ...(pre.cap !== null ? [`title_cap:${pre.cap}`] : [])],
      });
    }
    if (!passed.length) return { ...empty(), discarded };

    const passedIds = passed.map((p) => p.row.id);
    const skillRows = await tx
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
      .where(inArray(s.publicJobSkills.publicJobId, passedIds));
    const levelRows = await tx
      .select({ skillId: s.skillLevels.skillId, level: s.skillLevels.level })
      .from(s.skillLevels)
      .where(eq(s.skillLevels.userId, userId));
    const levelBySkill = new Map(levelRows.map((l) => [l.skillId, l.level]));
    const skillsByJob = new Map<string, typeof skillRows>();
    for (const r of skillRows) {
      skillsByJob.set(r.publicJobId, [...(skillsByJob.get(r.publicJobId) ?? []), r]);
    }

    const ranked = rankCandidates(
      passed.map((p) => ({
        ...p,
        id: p.row.id,
        postedAt: p.row.postedAt,
        exactRole: role !== null && p.row.roleHints.includes(role),
        score: poolPreScore({
          flags: p.flags,
          skills: (skillsByJob.get(p.row.id) ?? []).map((k) => ({
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
    ).slice(0, limit);

    // 5. Alta en jobs + job_sources + job_skills, en el orden del ranking
    const created: { id: string; hasJd: boolean }[] = [];
    let alreadyHad = 0;
    for (const { row: pj, flags } of ranked) {
      const hasJd = Boolean(pj.jdText?.trim());
      const status: JobStatus = hasJd ? "prefiltrada" : "pendiente_jd";
      const companyId = pj.companyId ?? (await upsertCompany(tx, pj.companyRaw));
      const [job] = await tx
        .insert(s.jobs)
        .values({
          userId,
          companyId,
          companyRaw: pj.companyRaw,
          title: pj.title,
          titleNormalized: pj.titleNormalized,
          canonicalUrl: pj.canonicalUrl,
          locationRaw: pj.locationRaw,
          countriesAllowed: pj.countriesAllowed,
          modality: pj.modality,
          contractType: pj.contractType,
          salaryMinUsd: pj.salaryMinUsd,
          salaryMaxUsd: pj.salaryMaxUsd,
          salaryPeriod: pj.salaryPeriod,
          salaryNote: pj.salaryNote,
          weeklyHours: pj.weeklyHours,
          candidatesCount: pj.candidatesCount,
          publicJobId: pj.id,
          jdText: pj.jdText,
          jdHash: pj.jdHash,
          jdShingles: pj.jdShingles,
          postedAt: pj.postedAt,
          firstSeenAt: now,
          status,
          flags,
          createdAt: now,
          updatedAt: now,
        })
        // Cubre los dos índices únicos: (user_id, public_job_id) y (user_id, canonical_url)
        .onConflictDoNothing()
        .returning({ id: s.jobs.id });
      if (!job) {
        alreadyHad++;
        continue;
      }
      await tx.insert(s.jobSources).values({
        jobId: job.id,
        kind: pj.sourceKind,
        sourceName: pj.sourceName,
        externalId: pj.externalId,
        url: pj.sourceUrl,
        rawRef: pj.rawRef,
        seenAt: now,
      });
      const skills = skillsByJob.get(pj.id) ?? [];
      if (skills.length) {
        await tx.insert(s.jobSkills).values(
          skills.map((k) => ({
            jobId: job.id,
            skillId: k.skillId,
            isMust: k.isMust,
            rawMention: k.rawMention,
          })),
        );
      }
      created.push({ id: job.id, hasJd });
    }

    // 6. Encolar las primeras con JD, en orden (idempotente si ya había un mensaje)
    const enqueueEvaluation = enqueueEvaluationWith(tx, createPgQueue(tx));
    const enqueuedJobIds: string[] = [];
    for (const c of created) {
      if (enqueuedJobIds.length >= enqueueTop) break;
      if (!c.hasJd) continue;
      await enqueueEvaluation(c.id, userId);
      enqueuedJobIds.push(c.id);
    }
    return {
      assigned: created.length,
      discarded,
      alreadyHad,
      enqueued: enqueuedJobIds.length,
      enqueuedJobIds,
    };
  });

  log.info(
    {
      assigned: result.assigned,
      discarded: result.discarded,
      already_had: result.alreadyHad,
      enqueued: result.enqueued,
    },
    "pool: asignación",
  );
  return result;
}
