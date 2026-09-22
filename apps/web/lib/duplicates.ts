import {
  createPgQueue,
  dismissPossibleDuplicate,
  enqueueEvaluationWith,
  mergePossibleDuplicate,
  type MergeDuplicateOutcome,
} from "@job-search-os/adapters";
import { withUser } from "./db";

/**
 * Posibles duplicados (JS-025, ADR-013): fusión manual y "no son la misma", con el rol de la app
 * y RLS. La regla de cuál queda está en el pipeline (planDuplicateMerge); todo corre en una
 * transacción: o se fusiona entero o no cambia nada.
 */
export async function mergeDuplicate(
  userId: string,
  jobId: string,
): Promise<MergeDuplicateOutcome> {
  return withUser(userId, (tx) =>
    mergePossibleDuplicate(tx, {
      userId,
      jobId,
      // Cola con RLS: job_queue.user_id = auth.uid(); el worker (rol dueño) la toma después
      enqueueEvaluation: enqueueEvaluationWith(tx, createPgQueue(tx)),
    }),
  );
}

export async function dismissDuplicate(userId: string, jobId: string): Promise<boolean> {
  return withUser(userId, (tx) => dismissPossibleDuplicate(tx, { userId, jobId }));
}
