import { schema as s, type Db } from "@job-search-os/db";
import { and, desc, eq } from "drizzle-orm";

/**
 * Lectura de la demo para la página pública (ronda 74). Va dentro del contexto con el rol de la app:
 * `demo_evaluations` y `public_jobs` tienen lectura abierta (rls/0004 y 0007). Nunca trae `jd_text`.
 */
export type DemoEvaluationView = {
  id: string;
  publicJobId: string;
  title: string;
  companyRaw: string;
  locationRaw: string | null;
  modality: string | null;
  sourceKind: string;
  sourceUrl: string;
  sourceName: string;
  score: number;
  accion: string;
  matchFuerte: string[];
  gaps: string[];
  bloqueadores: string[];
  riesgos: string[];
  veredicto: string;
  locationOk: string;
  model: string;
  evaluatedAt: Date;
};

export async function readDemoEvaluations(
  db: Db,
  profileKey: string,
): Promise<DemoEvaluationView[]> {
  return db
    .select({
      id: s.demoEvaluations.id,
      publicJobId: s.demoEvaluations.publicJobId,
      title: s.publicJobs.title,
      companyRaw: s.publicJobs.companyRaw,
      locationRaw: s.publicJobs.locationRaw,
      modality: s.publicJobs.modality,
      sourceKind: s.publicJobs.sourceKind,
      sourceUrl: s.publicJobs.sourceUrl,
      sourceName: s.publicJobs.sourceName,
      score: s.demoEvaluations.score,
      accion: s.demoEvaluations.accion,
      matchFuerte: s.demoEvaluations.matchFuerte,
      gaps: s.demoEvaluations.gaps,
      bloqueadores: s.demoEvaluations.bloqueadores,
      riesgos: s.demoEvaluations.riesgos,
      veredicto: s.demoEvaluations.veredicto,
      locationOk: s.demoEvaluations.locationOk,
      model: s.demoEvaluations.model,
      evaluatedAt: s.demoEvaluations.evaluatedAt,
    })
    .from(s.demoEvaluations)
    .innerJoin(s.publicJobs, eq(s.publicJobs.id, s.demoEvaluations.publicJobId))
    .where(and(eq(s.demoEvaluations.profileKey, profileKey)))
    .orderBy(desc(s.demoEvaluations.score), s.publicJobs.title);
}
