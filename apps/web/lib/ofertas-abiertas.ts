import { schema as s } from "@job-search-os/db";
import {
  applyRequirementAnswers,
  withCurrentProfileFacts,
  type OpenOfferTable,
  type RequirementAnswer,
} from "@job-search-os/pipeline";
import { and, desc, eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import type { PerfilActual } from "@/lib/ficha-context";
import { parseChecklist } from "@/lib/job-detail";

/** Tope de ofertas que se miran para el conteo: una lista enorme no encarece el detalle. */
export const OFERTAS_ABIERTAS_MAX = 300;

/**
 * Las tablas de requisitos de las ofertas abiertas de la persona («Esto mismo te pasa en N de tus M
 * ofertas», R31-08): una sola consulta, la última evaluación de cada oferta evaluada. Las tablas se
 * superponen con el perfil de hoy y con las respuestas de un toque, así que el conteo refleja lo
 * último que cargó la persona sin volver a evaluar nada.
 */
export async function loadOpenOfferTables(
  userId: string,
  perfil: PerfilActual,
  answers: ReadonlyMap<string, RequirementAnswer>,
): Promise<OpenOfferTable[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ jobId: s.evaluations.jobId, decision: s.evaluations.decision })
      .from(s.evaluations)
      .innerJoin(s.jobs, eq(s.jobs.id, s.evaluations.jobId))
      .where(and(eq(s.jobs.userId, userId), eq(s.jobs.status, "evaluada")))
      .orderBy(desc(s.evaluations.createdAt))
      .limit(OFERTAS_ABIERTAS_MAX * 2),
  );
  const seen = new Set<string>();
  const out: OpenOfferTable[] = [];
  for (const r of rows) {
    if (seen.has(r.jobId)) continue;
    seen.add(r.jobId);
    const checklist = parseChecklist(r.decision);
    if (!checklist) continue;
    const now = applyRequirementAnswers(withCurrentProfileFacts(checklist, perfil), answers);
    out.push({ jobId: r.jobId, items: now.items });
    if (out.length >= OFERTAS_ABIERTAS_MAX) break;
  }
  return out;
}
