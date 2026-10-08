import { schema as s, type Db } from "@job-search-os/db";
import {
  transition,
  type ApplicationOutcome,
  type JobEvent,
  type JobStatus,
} from "@job-search-os/pipeline";
import { and, eq } from "drizzle-orm";

/**
 * Cambio de estado de una oferta con su postulación (JS-016, JS-036). Lo usan la app (dentro de
 * `withUser`, con el rol de la app y RLS) y el inbound (conexión de servicio, siempre con
 * `user_id` explícito): el estado nunca se escribe directo, siempre pasa por transition().
 */
export type ApplicationsExecutor = Pick<Db, "select" | "insert" | "update">;

/** Evento → resultado de la postulación (si existe). `close` desde aplicada = cerrada antes de responder. */
const EVENT_OUTCOME: Partial<Record<JobEvent, ApplicationOutcome>> = {
  reject: "rechazo_humano",
  auto_reject: "rechazo_automatico_otro",
  interview: "entrevista",
  offer: "oferta",
  close: "cerrada_antes",
};

/** Estados desde `aplicada` en adelante en el embudo: ahí una postulación ya está registrada. */
export const APPLIED_OR_LATER: readonly JobStatus[] = [
  "aplicada",
  "rechazo_automatico",
  "rechazada",
  "entrevista",
  "oferta",
];

/**
 * Cambia el estado con transition() (lanza InvalidTransitionError si no corresponde). En `apply`
 * deja constancia en applications con `applied_at = now`; los eventos posteriores actualizan su
 * resultado (feedback loop, JS-036).
 */
export async function applyJobEventIn(
  tx: ApplicationsExecutor,
  userId: string,
  jobId: string,
  event: JobEvent,
  now: Date = new Date(),
): Promise<JobStatus> {
  const [job] = await tx
    .select({ status: s.jobs.status })
    .from(s.jobs)
    .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
    .limit(1);
  if (!job) throw new Error("oferta inexistente");
  const next = transition(job.status, event);
  await tx
    .update(s.jobs)
    .set({ status: next, updatedAt: now })
    .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)));
  if (event === "apply") {
    const [existing] = await tx
      .select({ id: s.applications.id })
      .from(s.applications)
      .where(and(eq(s.applications.jobId, jobId), eq(s.applications.userId, userId)))
      .limit(1);
    if (!existing) {
      await tx.insert(s.applications).values({ jobId, userId, appliedAt: now });
    }
  }
  const outcome = EVENT_OUTCOME[event];
  if (outcome) {
    await tx
      .update(s.applications)
      .set({ outcome, outcomeAt: now })
      .where(and(eq(s.applications.jobId, jobId), eq(s.applications.userId, userId)));
  }
  return next;
}
