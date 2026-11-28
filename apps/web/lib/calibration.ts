import { schema as s } from "@job-search-os/db";
import {
  isCalibrationPrompt,
  selectCalibrationSet,
  type CalibrationItem,
  type CalibrationMark,
  type CalibrationVerdict,
} from "@job-search-os/pipeline";
import { and, desc, eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { canViewRecorrido } from "@/lib/recorrido-access";
import { requirementAnswersAllowedFor } from "@/lib/requirement-answers";

/**
 * Kit para calibrar la evaluación nueva (R31-10). Todo es solo para admins y testers (`canViewRecorrido`, el
 * mismo criterio que `/recorrido`) y solo con `JOB_CARD` encendida para la persona: con la variable apagada la
 * pantalla no existe (404) y la app se ve igual que al cerrar la R30. La lista sale de las ofertas DE LA PERSONA
 * (RLS) evaluadas con `evaluate_job@v1.5+`; las marcas reutilizan «¿Te sirve esta evaluación?» y «Proponer otro
 * puntaje», que ya guardan en `evaluations`. La exportación del admin lee `admin_calibration_marks` (rls/0073),
 * sin datos personales. Nada de esto cambia un puntaje ni una decisión.
 */

export async function calibrationAllowedFor(userId: string): Promise<boolean> {
  try {
    return (await canViewRecorrido(userId)) && (await requirementAnswersAllowedFor(userId));
  } catch {
    return false;
  }
}

export type CalibrationEntry = {
  jobId: string;
  evaluationId: string;
  title: string;
  company: string;
  score: number;
  accion: string;
  discipline: string;
  modality: string;
  language: string | null;
  blockers: string[];
  verdict: CalibrationVerdict | null;
  note: string | null;
  humanScore: number | null;
};

const MAX_EVALUATIONS_READ = 600;

/**
 * La última evaluación nueva de cada oferta de la persona, la más reciente primero. Una consulta, con tope.
 * La ficha (idioma del aviso) se une por el hash del texto: puede no existir.
 */
export async function loadCalibrationEntries(userId: string): Promise<CalibrationEntry[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        jobId: s.evaluations.jobId,
        evaluationId: s.evaluations.id,
        promptVersion: s.evaluations.promptVersion,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        score: s.evaluations.score,
        accion: s.evaluations.accion,
        discipline: s.evaluations.discipline,
        modality: s.evaluations.modality,
        blockers: s.evaluations.bloqueadoresDuros,
        verdict: s.evaluations.humanVerdict,
        note: s.evaluations.humanNote,
        humanScore: s.evaluations.humanScore,
        language: s.jobCards.jdLanguage,
      })
      .from(s.evaluations)
      .innerJoin(s.jobs, eq(s.jobs.id, s.evaluations.jobId))
      .leftJoin(s.jobCards, eq(s.jobCards.jdHash, s.jobs.jdHash))
      .where(
        and(
          eq(s.evaluations.userId, userId),
          sql`${s.evaluations.promptVersion} ~ '^evaluate_job@v(1\\.([5-9]|[1-9][0-9]+)|[2-9]|[1-9][0-9]+)'`,
        ),
      )
      .orderBy(desc(s.evaluations.createdAt))
      .limit(MAX_EVALUATIONS_READ),
  );
  const seen = new Set<string>();
  const out: CalibrationEntry[] = [];
  for (const r of rows) {
    if (seen.has(r.jobId) || !isCalibrationPrompt(r.promptVersion)) continue;
    seen.add(r.jobId);
    out.push({
      jobId: r.jobId,
      evaluationId: r.evaluationId,
      title: r.title,
      company: r.company,
      score: r.score,
      accion: r.accion,
      discipline: r.discipline,
      modality: r.modality,
      language: r.language,
      blockers: r.blockers,
      verdict: r.verdict,
      note: r.note,
      humanScore: r.humanScore,
    });
  }
  return out;
}

/** Entre 20 y 30 ofertas variadas, en el orden en que conviene recorrerlas. */
export function pickCalibrationEntries(
  entries: readonly CalibrationEntry[],
  target?: number,
): CalibrationEntry[] {
  const items: CalibrationItem[] = entries.map((e) => ({
    id: e.jobId,
    discipline: e.discipline,
    modality: e.modality,
    language: e.language,
    hasBlocking: e.blockers.length > 0,
    score: e.score,
  }));
  const byId = new Map(entries.map((e) => [e.jobId, e] as const));
  return selectCalibrationSet(items, target).map((i) => byId.get(i.id)!);
}

type RawMark = {
  marked_at: Date | string | null;
  person: string;
  job_ref: string;
  title: string | null;
  company: string | null;
  prompt_version: string;
  discipline: string;
  modality: string;
  english: string;
  had_full_jd: boolean;
  score: number | string;
  accion: string;
  blockers: number | string;
  verdict: string | null;
  note: string | null;
  human_score: number | string | null;
};

const day = (v: Date | string | null): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Lo marcado por todos, sin datos personales. Solo para admins: la función de la base se lo exige otra vez. */
export async function loadAdminCalibrationMarks(adminUserId: string): Promise<CalibrationMark[]> {
  const rows = await withUser(adminUserId, async (tx) => {
    const res = await tx.execute(sql`select * from public.admin_calibration_marks(2000)`);
    return res as unknown as RawMark[];
  });
  return rows.map((r) => ({
    person: r.person,
    jobRef: r.job_ref,
    promptVersion: r.prompt_version,
    discipline: r.discipline,
    modality: r.modality,
    english: r.english,
    hadFullJd: r.had_full_jd,
    score: Number(r.score),
    accion: r.accion,
    blockers: Number(r.blockers),
    verdict: r.verdict === "de_acuerdo" || r.verdict === "en_desacuerdo" ? r.verdict : null,
    note: r.note,
    humanScore: r.human_score === null ? null : Number(r.human_score),
    markedAt: day(r.marked_at),
    title: r.title,
    company: r.company,
  }));
}
