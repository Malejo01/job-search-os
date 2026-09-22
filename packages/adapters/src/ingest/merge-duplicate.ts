import { schema as s, type Db } from "@job-search-os/db";
import {
  planDuplicateMerge,
  POSSIBLE_DUPLICATE_FLAG,
  textShingles,
  type DuplicateCandidate,
  type DuplicateMergeError,
  type Term,
} from "@job-search-os/pipeline";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { loadTaxonomy, syncJobSkillsFromText } from "../skills/sync";
import { jdHash } from "./ingest-job";

/**
 * Fusión manual y descarte de un `posible_duplicado` (JS-025, ADR-013). La regla (cuál queda,
 * qué se lleva) es `planDuplicateMerge`, en el pipeline; acá se aplica en la base. Pensado para
 * correr dentro de una transacción con app.user_id fijado (RLS): o se aplica todo o nada.
 */
export class DuplicateMergeFailure extends Error {
  constructor(readonly code: DuplicateMergeError | "not_found" | "evaluating") {
    super(`fusión manual rechazada: ${code}`);
    this.name = "DuplicateMergeFailure";
  }
}

export type MergeDuplicateInput = {
  userId: string;
  /** El job con la marca `posible_duplicado`. */
  jobId: string;
  taxonomy?: readonly Term[];
  enqueueEvaluation?: (jobId: string, userId: string) => Promise<void>;
  now?: () => Date;
};

export type MergeDuplicateOutcome = { survivorId: string; absorbedId: string; enqueued: boolean };

async function candidate(db: Db, userId: string, id: string) {
  const [job] = await db
    .select({
      id: s.jobs.id,
      duplicateOfId: s.jobs.duplicateOfId,
      status: s.jobs.status,
      jdText: s.jobs.jdText,
      firstSeenAt: s.jobs.firstSeenAt,
      flags: s.jobs.flags,
      canonicalUrl: s.jobs.canonicalUrl,
      // "jobs"."id" calificado a mano: drizzle escribe "id" suelto y la subconsulta lo resolvería
      // contra su propia tabla
      hasHistory: sql<boolean>`(
        exists (select 1 from ${s.evaluations} e where e.job_id = "jobs"."id")
        or exists (select 1 from ${s.applications} a where a.job_id = "jobs"."id")
      )`,
    })
    .from(s.jobs)
    .where(and(eq(s.jobs.id, id), eq(s.jobs.userId, userId)))
    .for("update")
    .limit(1);
  if (!job) return null;
  const c: DuplicateCandidate = {
    id: job.id,
    duplicateOfId: job.duplicateOfId,
    status: job.status,
    jdLength: job.jdText?.length ?? 0,
    firstSeenAt: job.firstSeenAt,
    flags: job.flags ?? [],
    canonicalUrl: job.canonicalUrl,
    hasHistory: job.hasHistory,
  };
  return { c, jdText: job.jdText };
}

/**
 * Fusiona el job marcado con el que apunta la marca. Las fuentes del absorbido (con su crudo,
 * JS-024) pasan al que queda; el absorbido se borra. Otros jobs marcados contra el absorbido
 * pasan a apuntar al que queda.
 */
export async function mergePossibleDuplicate(
  db: Db,
  input: MergeDuplicateInput,
): Promise<MergeDuplicateOutcome> {
  const { userId, jobId } = input;
  const now = input.now?.() ?? new Date();

  const flagged = await candidate(db, userId, jobId);
  if (!flagged?.c.duplicateOfId) throw new DuplicateMergeFailure("not_found");
  const target = await candidate(db, userId, flagged.c.duplicateOfId);
  if (!target) throw new DuplicateMergeFailure("not_found");

  const plan = planDuplicateMerge(flagged.c, target.c);
  if (!plan.ok) throw new DuplicateMergeFailure(plan.error);
  const { survivorId, absorbedId } = plan.value;
  const absorbedJd = (absorbedId === flagged.c.id ? flagged : target).jdText;

  // Una evaluación en curso del absorbido quedaría huérfana: mejor esperar a que termine
  const queued = await db
    .select({ id: s.jobQueue.id, status: s.jobQueue.status })
    .from(s.jobQueue)
    .where(
      and(
        sql`${s.jobQueue.payload}->>'jobId' = ${absorbedId}`,
        inArray(s.jobQueue.status, ["pending", "processing"]),
      ),
    );
  if (queued.some((q) => q.status === "processing")) {
    throw new DuplicateMergeFailure("evaluating");
  }
  if (queued.length) {
    await db.delete(s.jobQueue).where(
      inArray(
        s.jobQueue.id,
        queued.map((q) => q.id),
      ),
    );
  }

  await db
    .update(s.jobSources)
    .set({ jobId: survivorId })
    .where(eq(s.jobSources.jobId, absorbedId));
  await db
    .update(s.jobs)
    .set({ duplicateOfId: survivorId, updatedAt: now })
    .where(
      and(
        eq(s.jobs.userId, userId),
        eq(s.jobs.duplicateOfId, absorbedId),
        ne(s.jobs.id, survivorId),
      ),
    );
  // Antes de pasarle la URL al que queda: el índice único (user_id, canonical_url)
  await db.delete(s.jobs).where(and(eq(s.jobs.id, absorbedId), eq(s.jobs.userId, userId)));

  const jd = plan.value.takeJdFromAbsorbed ? absorbedJd : null;
  await db
    .update(s.jobs)
    .set({
      firstSeenAt: plan.value.firstSeenAt,
      flags: plan.value.flags,
      canonicalUrl: plan.value.canonicalUrl,
      duplicateOfId: null,
      updatedAt: now,
      ...(jd ? { jdText: jd, jdHash: jdHash(jd), jdShingles: textShingles(jd) } : {}),
    })
    .where(eq(s.jobs.id, survivorId));

  if (jd) {
    await syncJobSkillsFromText(db, survivorId, jd, input.taxonomy ?? (await loadTaxonomy(db)));
  }
  let enqueued = false;
  if (plan.value.enqueueEvaluation && input.enqueueEvaluation) {
    await input.enqueueEvaluation(survivorId, userId);
    enqueued = true;
  }
  return { survivorId, absorbedId, enqueued };
}

/** "No son la misma": saca la marca y el puntero. Devuelve si había algo que sacar. */
export async function dismissPossibleDuplicate(
  db: Db,
  input: { userId: string; jobId: string; now?: () => Date },
): Promise<boolean> {
  const rows = await db
    .update(s.jobs)
    .set({
      duplicateOfId: null,
      flags: sql`array_remove(coalesce(${s.jobs.flags}, '{}'), ${POSSIBLE_DUPLICATE_FLAG})`,
      updatedAt: input.now?.() ?? new Date(),
    })
    .where(
      and(
        eq(s.jobs.id, input.jobId),
        eq(s.jobs.userId, input.userId),
        sql`${POSSIBLE_DUPLICATE_FLAG} = any(${s.jobs.flags})`,
      ),
    )
    .returning({ id: s.jobs.id });
  return rows.length > 0;
}
