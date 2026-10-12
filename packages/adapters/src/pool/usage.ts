import { schema as s, type Db } from "@job-search-os/db";
import { monthlyUsd, preScore, type PreScore } from "@job-search-os/pipeline";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { EVALUATE_QUEUE } from "../queue/pg-queue";

/**
 * Contadores y puntaje compartidos por la asignación inicial (`assign.ts`) y la diaria
 * (`daily.ts`, `backlog.ts`). Las dos usan los mismos números para que el tope por ventana de 24 h
 * sea uno solo.
 */

/** Ofertas del pool asignadas al usuario desde `since`. */
export async function countPoolAssigned(db: Db, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.jobs)
    .where(
      and(eq(s.jobs.userId, userId), isNotNull(s.jobs.publicJobId), gte(s.jobs.createdAt, since)),
    );
  return row?.n ?? 0;
}

/** Mensajes `evaluate_job` creados desde `since` para ofertas del pool del usuario. */
export async function countPoolQueued(db: Db, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.jobQueue)
    .innerJoin(s.jobs, sql`${s.jobs.id}::text = ${s.jobQueue.payload}->>'jobId'`)
    .where(
      and(
        eq(s.jobQueue.queue, EVALUATE_QUEUE),
        eq(s.jobs.userId, userId),
        isNotNull(s.jobs.publicJobId),
        gte(s.jobQueue.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

/** Período de la fuente tal como está en la base; lo desconocido queda en null (no se supone mensual). */
export function salaryPeriod(value: string | null): "mensual" | "anual" | "hora" | null {
  return value === "mensual" || value === "anual" || value === "hora" ? value : null;
}

/** Pre-score de una oferta del pool (asignada o por asignar); mismo cálculo en los dos lados. */
export function poolPreScore(input: {
  flags: readonly string[];
  skills: readonly { slug: string; name: string; isMust: boolean; level: number | null }[];
  salaryMaxUsd: number | null;
  salaryPeriod: string | null;
  salaryFloorUsd: number | null;
}): PreScore {
  return preScore({
    flags: input.flags,
    skills: input.skills,
    salaryMaxUsd: monthlyUsd(input.salaryMaxUsd, salaryPeriod(input.salaryPeriod)),
    salaryFloorUsd: input.salaryFloorUsd,
  });
}
