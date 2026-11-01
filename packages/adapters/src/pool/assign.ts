import { schema as s, type Db } from "@job-search-os/db";
import { areasFilterEnabled, type JobStatus } from "@job-search-os/pipeline";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { loadActiveRules } from "../ingest/run-getonboard";
import { loadProfilePrefilterPrefs, upsertCompany } from "../ingest/ingest-job";
import type { Logger } from "../logger";
import { createPgQueue, enqueueEvaluationWith } from "../queue/pg-queue";
import { DAY_MS, selectPoolCandidates } from "./select";
import { countPoolAssigned, countPoolQueued } from "./usage";

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
  /** Ofertas no tocadas que se borraron antes de asignar (`replaceUntouched`). */
  replaced: number;
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
  /**
   * Baja de orden y marca lo que queda fuera de las áreas de especialidad que eligió la persona (C5-3).
   * Sin valor lee `AREAS_FILTER_ENABLED` (apagado por defecto). Nunca descarta una oferta.
   */
  areasFilter?: boolean;
  /**
   * Antes de asignar, borra (mismo lock y transacción) las ofertas del pool del usuario que no se
   * tocaron: estado inicial, sin evaluación, sin mensaje en la cola y sin referencias de usuario. El
   * aviso sigue en `public_jobs` y puede volver a asignarse. Sin reglas activas no se borra nada.
   */
  replaceUntouched?: boolean;
  logger: Logger;
  now?: () => Date;
};

// Los topes y ventanas viven en select.ts; se reexportan para quien los importaba de acá
export { CANDIDATE_CAP, POSTED_WINDOW_DAYS, SEEN_WINDOW_DAYS } from "./select";

/** `profiles.target_specialties` tal como está guardado; `null` = «Todas las áreas». */
async function loadTargetSpecialties(tx: Db, userId: string): Promise<unknown> {
  const [row] = await tx
    .select({ saved: s.profiles.targetSpecialties })
    .from(s.profiles)
    .where(eq(s.profiles.userId, userId))
    .limit(1);
  return row?.saved ?? null;
}

const empty = (replaced = 0): AssignResult => ({
  assigned: 0,
  discarded: 0,
  alreadyHad: 0,
  enqueued: 0,
  enqueuedJobIds: [],
  replaced,
});

export async function assignPoolToUser(
  db: Db,
  userId: string,
  opts: AssignOptions,
): Promise<AssignResult> {
  const log = opts.logger.child({ user_id: userId });
  if (opts.limit <= 0) return empty();
  const now = opts.now?.() ?? new Date();

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool-assign:${userId}`}))`);

    // 1. Criterios: sin criterios no hay prefiltro posible, no se borra ni se asigna nada
    const rules = await loadActiveRules(tx, userId);
    if (!rules) return empty();

    // Reemplazo: borra lo no tocado antes de contar, así el conteo de 24 h baja solo.
    // Tablas con FK a jobs.id revisadas: job_sources y job_skills (cascade, se van con el job);
    // evaluations, applications y application_answers (tocan el job: se queda); answer_bank
    // (source_job_id, set null: una referencia también cuenta como tocado). job_queue y llm_calls
    // no tienen FK: la cola se mira por payload->>'jobId', en cualquier estado. jobs.duplicate_of_id
    // tampoco tiene FK: un job al que otro apunta como original también cuenta como tocado.
    let replaced = 0;
    if (opts.replaceUntouched) {
      const deleted = await tx
        .delete(s.jobs)
        .where(
          and(
            eq(s.jobs.userId, userId),
            isNotNull(s.jobs.publicJobId),
            inArray(s.jobs.status, ["prefiltrada", "pendiente_jd"]),
            sql`not exists (select 1 from ${s.evaluations} where ${s.evaluations.jobId} = ${s.jobs.id})`,
            sql`not exists (select 1 from ${s.applications} where ${s.applications.jobId} = ${s.jobs.id})`,
            sql`not exists (select 1 from ${s.applicationAnswers} where ${s.applicationAnswers.jobId} = ${s.jobs.id})`,
            sql`not exists (select 1 from ${s.answerBank} where ${s.answerBank.sourceJobId} = ${s.jobs.id})`,
            sql`not exists (select 1 from ${s.jobs} d where d.duplicate_of_id = ${s.jobs.id})`,
            sql`not exists (select 1 from ${s.jobQueue} where ${s.jobQueue.payload}->>'jobId' = ${s.jobs.id}::text)`,
          ),
        )
        .returning({ id: s.jobs.id });
      replaced = deleted.length;
    }

    // Topes efectivos. Con `deductLast24h` se descuenta, dentro del lock, lo ya asignado y lo ya
    // encolado en las últimas 24 h: dos envíos paralelos del onboarding no suman el doble.
    let limit = opts.limit;
    let enqueueTop = opts.enqueueTop;
    if (opts.deductLast24h) {
      const since = new Date(now.getTime() - DAY_MS);
      limit = Math.max(0, limit - (await countPoolAssigned(tx, userId, since)));
      enqueueTop = Math.max(0, enqueueTop - (await countPoolQueued(tx, userId, since)));
      if (limit === 0) return empty(replaced);
    }

    // 2. Perfil y criterios de prefiltro
    const prefs = await loadProfilePrefilterPrefs(tx, userId);

    // 3. Niveles de skills de la persona
    const levelRows = await tx
      .select({ skillId: s.skillLevels.skillId, level: s.skillLevels.level })
      .from(s.skillLevels)
      .where(eq(s.skillLevels.userId, userId));
    const levelBySkill = new Map(levelRows.map((l) => [l.skillId, l.level]));

    // 3b. Áreas de especialidad elegidas (C5-3): solo se leen con el interruptor prendido
    const areas =
      (opts.areasFilter ?? areasFilterEnabled(process.env))
        ? { saved: await loadTargetSpecialties(tx, userId) }
        : null;

    // 4. Candidatas, prefiltro, pre-score y ranking (select.ts, solo lectura)
    const selection = await selectPoolCandidates(tx, {
      userId,
      rules,
      prefs,
      levelBySkill,
      now,
      limit,
      areas,
    });
    const discarded = selection.discarded.length;
    if (!selection.ranked.length) return { ...empty(replaced), discarded };
    const { ranked, skillsByPublicJob: skillsByJob } = selection;

    // 5. Alta en jobs + job_sources + job_skills, en el orden del ranking
    const created: { id: string; hasJd: boolean }[] = [];
    let alreadyHad = 0;
    for (const { row: pj, flags, matchedRole } of ranked) {
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
          matchedRole,
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
      replaced,
    };
  });

  log.info(
    {
      assigned: result.assigned,
      discarded: result.discarded,
      already_had: result.alreadyHad,
      enqueued: result.enqueued,
      replaced: result.replaced,
    },
    "pool: asignación",
  );
  return result;
}
