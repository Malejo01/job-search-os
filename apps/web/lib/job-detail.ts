import { applyJobEventIn, loadChecklistSkills, salaryFromApiKinds } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import {
  applicationEffect,
  availableEvents,
  checklistOnRead,
  correctionTargets,
  correctStatus,
  effectiveAcceptedModalities,
  EvaluationSchema,
  isEnglishSkillSlug,
  MANUAL_JOB_EVENTS,
  planDuplicateMerge,
  POSSIBLE_DUPLICATE_FLAG,
  prefilterReasonText,
  type Adjustment,
  type Checklist,
  type CriteriaRules,
  type HumanVerdict,
  type JobEvent,
  type JobStatus,
} from "@job-search-os/pipeline";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { withUser, type Tx } from "./db";
import { isUuid } from "./ids";
import { evaluatingSql } from "./jobs";
import { preScoresFor, type PreScoreView } from "./prescore";
import { skillInfoIn, type SkillInfo } from "./skill-levels";

/**
 * Detalle y acciones de una oferta (JS-016). Lecturas y escrituras con el rol de la app y
 * app.user_id fijado (RLS). jobs.status nunca se escribe directo: siempre transition().
 */
/**
 * Checklist de requisitos del aviso (ronda 104, diseño 98 §2.1). Lo arma `buildChecklist` del
 * pipeline y vive en `evaluations.decision.checklist` (jsonb): las evaluaciones viejas no lo
 * tienen y lo guardado no es de fiar, por eso se valida la forma al leer. `checklistContract`
 * hace fallar el typecheck si el tipo del pipeline deja de entrar en este schema.
 */
const countsSchema = z.object({
  cumple: z.number().int().min(0),
  no_cumple: z.number().int().min(0),
  no_se_sabe: z.number().int().min(0),
});
const checklistItemSchema = z.object({
  id: z.string().max(80),
  kind: z.enum(["estructurado", "skill", "texto"]),
  nivel: z.enum(["must", "deseable"]),
  // Topes del otro lado: CHECKLIST_TEXT_MAX (160, + «…») y CHECKLIST_MAX_ITEMS (40) en
  // packages/pipeline/src/evaluator/checklist.ts. Acá un poco más holgados.
  pide: z.string().max(200),
  evidencia: z.string().max(600).nullable(),
  tenes: z.string().max(200).nullable(),
  status: z.enum(["cumple", "no_cumple", "no_se_sabe"]),
  fuente: z.object({
    pide: z.enum(["fuente", "modelo"]),
    tenes: z.enum(["perfil", "skills"]).nullable(),
  }),
  bloquea: z.boolean(),
  // Aclaración del código (por ejemplo «salario leído del texto del aviso»); opcional
  nota: z.string().max(200).optional(),
});
const checklistSchema = z.object({
  items: z.array(checklistItemSchema).max(40),
  must: countsSchema,
  deseable: countsSchema,
  parcial: z.boolean(),
  descarte_rapido: checklistItemSchema.nullable(),
});
export type ChecklistItemView = z.infer<typeof checklistItemSchema>;
export type ChecklistView = z.infer<typeof checklistSchema>;
export const checklistContract = (c: Checklist): ChecklistView => c;

/** Lee y valida `decision.checklist`; `null` si falta o no tiene la forma esperada. */
export function parseChecklist(decision: unknown): ChecklistView | null {
  if (!decision || typeof decision !== "object") return null;
  const parsed = checklistSchema.safeParse((decision as { checklist?: unknown }).checklist);
  return parsed.success ? parsed.data : null;
}

export type EvaluationView = {
  id: string;
  score: number;
  scoreModel: number | null;
  accion: string;
  accionSugerida: string | null;
  promptVersion: string;
  model: string;
  hadFullJd: boolean;
  locationOk: string;
  modality: string;
  discipline: string;
  englishRequired: string;
  companyType: string | null;
  yearsRequired: number | null;
  matchFuerte: string[];
  gaps: string[];
  bloqueadores: string[];
  riesgos: string[];
  senales: string[];
  veredicto: string;
  adjustments: Adjustment[];
  /**
   * Requisitos del aviso (ronda 104). En evaluaciones viejas se arma al leer, solo la parte
   * determinista y con `parcial: true` (C9-6); null si tampoco así se puede.
   */
  checklist: ChecklistView | null;
  humanScore: number | null;
  humanNote: string | null;
  /** 👍/👎 de un toque (ronda 30); null = sin opinión. No es un score: no entra en el MAE. */
  humanVerdict: HumanVerdict | null;
  createdAt: string;
};

/** Largo máximo del motivo corto del veredicto (se guarda en human_note). */
export const HUMAN_NOTE_MAX = 140;

export type JobDetail = {
  id: string;
  title: string;
  company: string;
  status: JobStatus;
  locationRaw: string | null;
  /** Link a la publicación original (canonical_url o, si no hay, la URL de alguna fuente). */
  url: string | null;
  countriesAllowed: string[] | null;
  modality: string | null;
  contractType: string | null;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: string | null;
  weeklyHours: number | null;
  candidatesCount: number | null;
  badges: string[];
  flags: string[];
  /** Motivo del descarte en castellano llano (prefilterReasonText), no el valor crudo guardado. */
  prefilterReason: string | null;
  jdText: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  sources: { kind: string; name: string | null; url: string | null; seenAt: string }[];
  evaluation: EvaluationView | null;
  /** Modo offline: lo que se sabe sin LLM (null si ya hay evaluación o la oferta fue descartada). */
  preScore: PreScoreView | null;
  /** Nombre, «¿Qué es?» y nivel actual de las skills del aviso que se cargan desde esta pantalla. */
  skillInfo: Record<string, SkillInfo>;
  application: { appliedAt: string | null; outcome: string | null } | null;
  /** Eventos manuales válidos desde el estado actual (para los botones). */
  events: JobEvent[];
  /** Evaluación en cola o en curso (JS-027): la página se actualiza sola hasta que termine. */
  evaluating: boolean;
  /** Estados a los que se puede corregir a mano (JS-028); vacío si no hay nada que corregir. */
  corrections: JobStatus[];
  /** Marcada `posible_duplicado` (ADR-013): la oferta parecida y si se puede fusionar (JS-025). */
  possibleDuplicateOf: (DuplicateRef & { canMerge: boolean }) | null;
  /** Ofertas marcadas como posible duplicado de esta. */
  possibleDuplicates: DuplicateRef[];
};

export type DuplicateRef = { id: string; title: string; company: string; status: JobStatus };

/** Eventos que puede disparar la persona desde la UI (el resto los dispara el pipeline). */
export const MANUAL_EVENTS: readonly JobEvent[] = MANUAL_JOB_EVENTS;

export type ChangeStatusResult =
  | { ok: true; status: JobStatus }
  | {
      ok: false;
      code: "evento" | "transicion" | "cambio_estado" | "inexistente";
      /** Estado actual, si la oferta cambió desde que se armó la tarjeta. */
      current?: JobStatus;
    };

/**
 * Núcleo común del cambio de estado manual (botones del detalle y tarjetas del asistente): valida que
 * el evento sea de los manuales y aplica la transición con `transition()`. Con `expected`, además,
 * compara y cambia en la misma transacción (`FOR UPDATE`): si la oferta ya no está en ese estado no
 * toca nada y devuelve `cambio_estado` (una tarjeta vieja no pisa un cambio hecho después).
 */
export async function changeJobStatus(
  userId: string,
  jobId: string,
  event: string,
  expected?: JobStatus | null,
): Promise<ChangeStatusResult> {
  if (!(MANUAL_EVENTS as readonly string[]).includes(event)) return { ok: false, code: "evento" };
  if (!isUuid(jobId)) return { ok: false, code: "inexistente" };
  return withUser(userId, async (tx): Promise<ChangeStatusResult> => {
    const [row] = await tx
      .select({ status: s.jobs.status })
      .from(s.jobs)
      .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
      .for("update")
      .limit(1);
    if (!row) return { ok: false, code: "inexistente" };
    if (expected && row.status !== expected) {
      return { ok: false, code: "cambio_estado", current: row.status };
    }
    try {
      const status = await applyJobEventIn(tx, userId, jobId, event as JobEvent);
      return { ok: true, status };
    } catch (e) {
      if (e instanceof Error && e.name === "InvalidTransitionError") {
        return { ok: false, code: "transicion" };
      }
      throw e;
    }
  });
}

/**
 * Checklist al leer para evaluaciones sin `decision.checklist` (C9-6): las de antes de la ronda 104
 * (2026-10-21, #147) o con uno guardado que no valida. Solo la parte determinista
 * (`checklistOnRead`), siempre `parcial: true`. No escribe en la base ni llama a ningún LLM.
 *
 * Consultas extra, solo cuando falta el checklist Y `raw` es una evaluación del modelo válida (si
 * no, ninguna: por ejemplo las filas del golden sembrado, cuyo `raw` es la fila del golden):
 * - `profiles` (1) y `evaluation_criteria` activa (1);
 * - `loadChecklistSkills`: `skill_levels` (1) y `user_skills` (1), más el catálogo `skills` (1),
 *   que queda en caché del proceso 5 minutos (C5-7).
 * Total: 4, o 5 con el catálogo frío. Si el checklist armado nombra skills, `skillInfoIn` (más
 * abajo), que antes salía sin consultar con la lista vacía, hace 1 más: de 4 a 6 en el peor caso.
 * El origen del salario sale de `job_sources`, que el detalle ya leyó. Sin perfil o sin criterios
 * activos no hay checklist (2 consultas y nada más).
 */
async function checklistFromStored(
  tx: Tx,
  userId: string,
  ev: typeof s.evaluations.$inferSelect,
  adjustments: unknown,
  job: {
    title: string;
    salaryMinUsd: number | null;
    salaryMaxUsd: number | null;
    salaryPeriod: string | null;
    salaryNote: string | null;
    weeklyHours: number | null;
    jdText: string | null;
    countriesAllowed: string[] | null;
  },
  sources: readonly { kind: string }[],
): Promise<ChecklistView | null> {
  // Sin una evaluación del modelo en `raw` no hay nada que armar: ni se consulta
  if (!EvaluationSchema.safeParse(ev.raw).success) return null;
  const [profile] = await tx
    .select({
      yearsTotal: s.profiles.yearsTotal,
      englishCefr: s.profiles.englishCefr,
      locationCountry: s.profiles.locationCountry,
      workAuth: s.profiles.workAuth,
      acceptedModalities: s.profiles.acceptedModalities,
      remoteOnly: s.profiles.remoteOnly,
    })
    .from(s.profiles)
    .where(eq(s.profiles.userId, userId))
    .limit(1);
  const [criteria] = await tx
    .select({ rules: s.evaluationCriteria.rules })
    .from(s.evaluationCriteria)
    .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)))
    .orderBy(desc(s.evaluationCriteria.version))
    .limit(1);
  if (!profile || !criteria) return null;
  const skills = await loadChecklistSkills(tx, userId);
  const computed = checklistOnRead(
    {
      raw: ev.raw,
      score: ev.score,
      scoreModel: ev.scoreModel,
      accion: ev.accion,
      bloqueadoresDuros: ev.bloqueadoresDuros,
      riesgos: ev.riesgos,
      locationOk: ev.locationOk,
      hadFullJd: ev.hadFullJd,
      adjustments,
    },
    criteria.rules as CriteriaRules,
    {
      profile: {
        yearsTotal: profile.yearsTotal,
        englishCefr: profile.englishCefr,
        locationCountry: profile.locationCountry,
        workAuth: profile.workAuth,
        acceptedModalities: effectiveAcceptedModalities(profile),
      },
      job: {
        title: job.title,
        salaryMinUsd: job.salaryMinUsd,
        salaryMaxUsd: job.salaryMaxUsd,
        salaryPeriod: job.salaryPeriod,
        salaryNote: job.salaryNote,
        salaryFromApi: salaryFromApiKinds(sources.map((x) => x.kind)),
        weeklyHours: job.weeklyHours,
        jdText: job.jdText,
        countriesAllowed: job.countriesAllowed,
      },
      skillLevels: skills.skillLevels,
      userSkills: skills.userSkills,
      terms: skills.terms,
      skillNames: skills.skillNames,
    },
  );
  // Pasa por el mismo schema que lo guardado: si no entra, no se muestra
  return parseChecklist({ checklist: computed });
}

/**
 * `checklistOnRead: false` saltea el checklist al leer (y sus consultas extra) para quien no muestra
 * los requisitos: las herramientas del asistente. Lo guardado en `decision.checklist` se lee igual.
 */
export async function getJobDetail(
  userId: string,
  jobId: string,
  options: { checklistOnRead?: boolean } = {},
): Promise<JobDetail | null> {
  const onRead = options.checklistOnRead ?? true;
  return withUser(userId, async (tx) => {
    // Sin `jd_shingles` (miles de enteros para detectar duplicados, que esta pantalla no usa): C5-7
    const { jdShingles: _shingles, ...jobColumns } = getTableColumns(s.jobs);
    const [job] = await tx.select(jobColumns).from(s.jobs).where(eq(s.jobs.id, jobId)).limit(1);
    if (!job) return null;
    const [queued] = await tx
      .select({ evaluating: evaluatingSql() })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId));
    const sources = await tx
      .select({
        kind: s.jobSources.kind,
        name: s.jobSources.sourceName,
        url: s.jobSources.url,
        seenAt: s.jobSources.seenAt,
      })
      .from(s.jobSources)
      .where(eq(s.jobSources.jobId, jobId))
      .orderBy(s.jobSources.seenAt);
    const [ev] = await tx
      .select()
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, jobId))
      .orderBy(desc(s.evaluations.createdAt))
      .limit(1);
    const [app] = await tx
      .select({ appliedAt: s.applications.appliedAt, outcome: s.applications.outcome })
      .from(s.applications)
      .where(eq(s.applications.jobId, jobId))
      .orderBy(desc(s.applications.createdAt))
      .limit(1);
    const pre =
      !ev && job.status !== "descartada_prefiltro"
        ? ((
            await preScoresFor(tx, userId, [
              {
                id: job.id,
                flags: job.flags ?? [],
                salaryMaxUsd: job.salaryMaxUsd,
                salaryPeriod: job.salaryPeriod,
              },
            ])
          ).get(job.id) ?? null)
        : null;
    // Posibles duplicados (JS-025): la marca es el flag; el puntero solo lo usa también el golden
    const history = sql<boolean>`(
      exists (select 1 from evaluations e where e.job_id = "jobs"."id")
      or exists (select 1 from applications a where a.job_id = "jobs"."id")
    )`;
    const refCols = {
      id: s.jobs.id,
      title: s.jobs.title,
      company: s.jobs.companyRaw,
      status: s.jobs.status,
      duplicateOfId: s.jobs.duplicateOfId,
      firstSeenAt: s.jobs.firstSeenAt,
      flags: s.jobs.flags,
      canonicalUrl: s.jobs.canonicalUrl,
      jdLength: sql<number>`coalesce(length("jobs"."jd_text"), 0)::int`,
      hasHistory: history,
    };
    const flagged = (job.flags ?? []).includes(POSSIBLE_DUPLICATE_FLAG);
    const [self] = flagged
      ? await tx.select(refCols).from(s.jobs).where(eq(s.jobs.id, job.id))
      : [];
    const [other] =
      flagged && job.duplicateOfId
        ? await tx.select(refCols).from(s.jobs).where(eq(s.jobs.id, job.duplicateOfId))
        : [];
    const dupsOfThis = await tx
      .select({
        id: s.jobs.id,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        status: s.jobs.status,
      })
      .from(s.jobs)
      .where(
        and(
          eq(s.jobs.duplicateOfId, job.id),
          sql`${POSSIBLE_DUPLICATE_FLAG} = any(${s.jobs.flags})`,
        ),
      );
    const toCandidate = (r: typeof self) => ({ ...r!, flags: r!.flags ?? [] });
    const possibleDuplicateOf =
      self && other
        ? {
            id: other.id,
            title: other.title,
            company: other.company,
            status: other.status,
            canMerge: planDuplicateMerge(toCandidate(self), toCandidate(other)).ok,
          }
        : null;

    const decision = (ev?.decision ?? null) as {
      adjustments?: Adjustment[];
      accion_sugerida?: string;
    } | null;
    const checklist =
      parseChecklist(decision) ??
      (ev && onRead
        ? await checklistFromStored(tx, userId, ev, decision?.adjustments, job, sources)
        : null);

    // C-20: skills sin nivel que se cargan desde la oferta (checklist y pre-score). Las de inglés
    // se cargan por CEFR en Ajustes y quedan afuera.
    const skillSlugs = [
      ...(checklist?.items.flatMap((i) => (i.id.startsWith("skill:") ? [i.id.slice(6)] : [])) ??
        []),
      ...(pre?.unknownSkills.map((u) => u.slug) ?? []),
    ].filter((slug) => !isEnglishSkillSlug(slug));
    const skillInfo = await skillInfoIn(tx, userId, skillSlugs);

    return {
      id: job.id,
      title: job.title,
      company: job.companyRaw,
      status: job.status,
      locationRaw: job.locationRaw,
      url: job.canonicalUrl ?? sources.find((x) => x.url)?.url ?? null,
      countriesAllowed: job.countriesAllowed,
      modality: job.modality,
      contractType: job.contractType,
      salaryMinUsd: job.salaryMinUsd,
      salaryMaxUsd: job.salaryMaxUsd,
      salaryPeriod: job.salaryPeriod,
      weeklyHours: job.weeklyHours,
      candidatesCount: job.candidatesCount,
      badges: job.badges ?? [],
      flags: job.flags ?? [],
      prefilterReason: prefilterReasonText(job.prefilterReason),
      jdText: job.jdText,
      postedAt: job.postedAt?.toISOString() ?? null,
      firstSeenAt: job.firstSeenAt.toISOString(),
      sources: sources.map((x) => ({ ...x, seenAt: x.seenAt.toISOString() })),
      evaluation: ev
        ? {
            id: ev.id,
            score: ev.score,
            scoreModel: ev.scoreModel,
            accion: ev.accion,
            accionSugerida: decision?.accion_sugerida ?? null,
            promptVersion: ev.promptVersion,
            model: ev.model,
            hadFullJd: ev.hadFullJd,
            locationOk: ev.locationOk,
            modality: ev.modality,
            discipline: ev.discipline,
            englishRequired: ev.englishRequired,
            companyType: ev.companyType,
            yearsRequired: ev.yearsRequired,
            matchFuerte: ev.matchFuerte,
            gaps: ev.gaps,
            bloqueadores: ev.bloqueadoresDuros,
            riesgos: ev.riesgos,
            senales: ev.senalesPositivas,
            veredicto: ev.veredicto,
            adjustments: decision?.adjustments ?? [],
            checklist,
            humanScore: ev.humanScore,
            humanNote: ev.humanNote,
            humanVerdict: ev.humanVerdict,
            createdAt: ev.createdAt.toISOString(),
          }
        : null,
      preScore: pre,
      skillInfo,
      application: app
        ? { appliedAt: app.appliedAt?.toISOString() ?? null, outcome: app.outcome }
        : null,
      events: availableEvents(job.status).filter((e) => MANUAL_EVENTS.includes(e)),
      evaluating: Boolean(queued?.evaluating),
      corrections: correctionTargets(job.status, {
        hasEvaluation: Boolean(ev),
        hasJd: Boolean(job.jdText?.trim()),
      }),
      possibleDuplicateOf,
      possibleDuplicates: dupsOfThis,
    };
  });
}

/**
 * Cambia el estado con transition(); en `apply` deja constancia en applications y los eventos
 * posteriores actualizan su resultado. La lógica vive en adapters (la comparte el inbound).
 */
export async function applyJobEvent(
  userId: string,
  jobId: string,
  event: JobEvent,
): Promise<JobStatus> {
  return withUser(userId, (tx) => applyJobEventIn(tx, userId, jobId, event));
}

/**
 * Corrección manual de estado (JS-028): valida con correctStatus() (pipeline) y deja la
 * postulación coherente con el estado corregido. No pasa por transition() porque no es un
 * evento de la oferta sino el arreglo de uno mal marcado.
 */
export async function correctJobStatus(
  userId: string,
  jobId: string,
  to: JobStatus,
): Promise<{ from: JobStatus; to: JobStatus }> {
  return withUser(userId, async (tx) => {
    const [job] = await tx
      .select({ status: s.jobs.status, jdText: s.jobs.jdText })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId))
      .limit(1);
    if (!job) throw new Error("oferta inexistente");
    const [ev] = await tx
      .select({ id: s.evaluations.id })
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, jobId))
      .limit(1);
    // Lanza InvalidCorrectionError si la corrección no vale
    const next = correctStatus(job.status, to, {
      hasEvaluation: Boolean(ev),
      hasJd: Boolean(job.jdText?.trim()),
    });
    const now = new Date();
    await tx.update(s.jobs).set({ status: next, updatedAt: now }).where(eq(s.jobs.id, jobId));

    const mine = and(eq(s.applications.jobId, jobId), eq(s.applications.userId, userId));
    const effect = applicationEffect(next);
    if (effect.kind === "remove") {
      await tx.delete(s.applications).where(mine);
    } else {
      const [existing] = await tx
        .select({ id: s.applications.id })
        .from(s.applications)
        .where(mine)
        .limit(1);
      if (existing) {
        await tx
          .update(s.applications)
          .set({ outcome: effect.outcome, outcomeAt: effect.outcome ? now : null })
          .where(mine);
      } else if (effect.kind === "ensure") {
        await tx.insert(s.applications).values({
          jobId,
          userId,
          appliedAt: now,
          outcome: effect.outcome,
          outcomeAt: effect.outcome ? now : null,
        });
      }
    }
    return { from: job.status, to: next };
  });
}

/** La evaluación no existe o no es del usuario. Las acciones lo detectan con instanceof. */
export class EvaluationNotFoundError extends Error {
  override name = "EvaluationNotFoundError";
  constructor() {
    super("evaluación inexistente");
  }
}

/** El score humano está fuera de 0–10 o no va en pasos de 0,5. */
export class HumanScoreError extends Error {
  override name = "HumanScoreError";
  constructor() {
    super("el score humano va de 0 a 10 en pasos de 0,5");
  }
}

/** Score humano (0–10, medio punto) + nota sobre la última evaluación. */
export async function saveHumanScore(
  userId: string,
  evaluationId: string,
  humanScore: number | null,
  humanNote: string | null,
): Promise<void> {
  if (humanScore !== null && (humanScore < 0 || humanScore > 10 || (humanScore * 2) % 1 !== 0)) {
    throw new HumanScoreError();
  }
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.evaluations)
      .set({ humanScore, humanNote })
      .where(and(eq(s.evaluations.id, evaluationId), eq(s.evaluations.userId, userId)))
      .returning({ id: s.evaluations.id });
    if (!updated.length) throw new EvaluationNotFoundError();
  });
}

/** 👍/👎 de un toque (ronda 30). `null` lo quita. No toca el score humano ni la nota. */
export async function saveHumanVerdict(
  userId: string,
  jobId: string,
  evaluationId: string,
  verdict: HumanVerdict | null,
): Promise<void> {
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.evaluations)
      .set({ humanVerdict: verdict, humanVerdictAt: verdict ? new Date() : null })
      .where(
        and(
          eq(s.evaluations.id, evaluationId),
          eq(s.evaluations.jobId, jobId),
          eq(s.evaluations.userId, userId),
        ),
      )
      .returning({ id: s.evaluations.id });
    if (!updated.length) throw new EvaluationNotFoundError();
  });
}

/** Motivo corto del veredicto: solo `human_note`, máximo 140 caracteres. */
export async function saveHumanNote(
  userId: string,
  jobId: string,
  evaluationId: string,
  note: string | null,
): Promise<void> {
  const clean = note?.trim() || null;
  if (clean !== null && clean.length > HUMAN_NOTE_MAX) {
    throw new Error(`el motivo admite hasta ${HUMAN_NOTE_MAX} caracteres`);
  }
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.evaluations)
      .set({ humanNote: clean })
      .where(
        and(
          eq(s.evaluations.id, evaluationId),
          eq(s.evaluations.jobId, jobId),
          eq(s.evaluations.userId, userId),
        ),
      )
      .returning({ id: s.evaluations.id });
    if (!updated.length) throw new EvaluationNotFoundError();
  });
}
