import {
  createLogger,
  createPgQueue,
  enqueueEvaluationWith,
  ingestRawJob,
  loadTaxonomy,
  type IngestOutcome,
} from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { rawJobFromManual, type CriteriaRules, type ManualJobInput } from "@job-search-os/pipeline";
import { and, desc, eq } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Ingesta manual (JS-023): URL + texto pegado desde la UI o desde el MCP. Pasa por el mismo
 * ingestRawJob que las fuentes automáticas (dedup 14 días → prefiltro → estado → cola), con el
 * rol de la app y app.user_id (RLS): la única diferencia es que la fuente es `manual`.
 */
export {
  parseModality,
  rawJobFromManual as toRawJob,
  type ManualJobInput,
} from "@job-search-os/pipeline";

export async function ingestManualJob(
  userId: string,
  input: ManualJobInput,
): Promise<IngestOutcome> {
  if (!input.title.trim() || !input.company.trim())
    throw new Error("título y empresa son obligatorios");
  return withUser(userId, async (tx) => {
    const [criteria] = await tx
      .select({ rules: s.evaluationCriteria.rules })
      .from(s.evaluationCriteria)
      .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)))
      .orderBy(desc(s.evaluationCriteria.version))
      .limit(1);
    if (!criteria) throw new Error("usuario sin criterios activos");
    return ingestRawJob(rawJobFromManual(input), {
      db: tx,
      userId,
      rules: criteria.rules as CriteriaRules,
      logger: createLogger({ user_id: userId, source: "manual" }),
      enqueueEvaluation: enqueueEvaluationWith(tx, createPgQueue(tx)),
      taxonomy: await loadTaxonomy(tx),
    });
  });
}
