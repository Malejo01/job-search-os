import { schema as s, type Db } from "@job-search-os/db";
import { normalizeQuestion, rankAnswers, salaryAsk, type SalaryAsk } from "@job-search-os/pipeline";
import { and, asc, count, desc, eq } from "drizzle-orm";

/**
 * Contexto para responder formularios de postulación (JS-053). Lo consume el servidor MCP: Claude
 * redacta en el chat con estos datos y la persona aprueba. Acá no se llama a ningún modelo.
 * Pensado para correr dentro de una transacción con app.user_id fijado (RLS).
 */
export class ApplicantFailure extends Error {
  constructor(
    readonly code: "job_not_found" | "profile_not_found" | "empty_question" | "empty_form",
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ApplicantFailure";
  }
}

export const ANSWER_LANGS = ["es", "en"] as const;
export type AnswerLang = (typeof ANSWER_LANGS)[number];

async function jobExists(db: Db, userId: string, jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: s.jobs.id })
    .from(s.jobs)
    .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)));
  return Boolean(row);
}

/**
 * Lo que no está cargado se dice explícitamente: una lista vacía o un null los lee el modelo
 * como "no hay restricciones" y completa con lo que se le ocurre.
 */
export const NO_FACTS = {
  marca: "sin_hechos_cargados",
  instruccion:
    "No hay hechos del perfil cargados. No afirmes experiencia, proyectos, métricas ni logros: pedile a la persona que los cargue con pnpm applicant:sync o que te los dicte.",
} as const;
export const NO_FIXED_ANSWERS = {
  marca: "sin_respuestas_fijas_cargadas",
  instruccion:
    "No hay respuestas fijas cargadas (disponibilidad, contratación, derecho a trabajar, links). Preguntáselas a la persona; no las redactes.",
} as const;
export const NOT_LOADED = "SIN CARGAR: preguntale a la persona, no lo redactes";

type Fact = {
  project: string;
  claim: string;
  metric: string | null;
  source: string;
  verification: string;
};
type FixedAnswers = {
  availability: string;
  contract: string;
  work_authorization: string;
  links: { linkedin?: string; github?: string; portfolio?: string; cv?: string };
};

export type CandidateProfile = {
  profile: {
    headline: string | null;
    location: { city: string | null; country: string };
    remote_only: boolean;
    timezone: string | null;
    english_cefr: string | null;
    years_total: number | null;
    years_enterprise: number | null;
    work_auth: { us: boolean; eu: boolean; other?: string[] };
    max_weekly_hours: number | null;
    summary: string | null;
  };
  facts: Fact[] | typeof NO_FACTS;
  fixed_answers: FixedAnswers | typeof NO_FIXED_ANSWERS;
  /** Con job_id: para esa oferta. Sin job_id: como si no publicara rango. */
  salary: SalaryAsk & { job_id: string | null };
};

export async function getCandidateProfile(
  db: Db,
  input: { userId: string; jobId?: string | null },
): Promise<CandidateProfile> {
  const { userId } = input;
  const jobId = input.jobId ?? null;
  const [p] = await db.select().from(s.profiles).where(eq(s.profiles.userId, userId));
  if (!p) throw new ApplicantFailure("profile_not_found");

  const [criteria] = await db
    .select({ rules: s.evaluationCriteria.rules })
    .from(s.evaluationCriteria)
    .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)))
    .orderBy(desc(s.evaluationCriteria.version))
    .limit(1);

  const facts = await db
    .select({
      project: s.candidateFacts.project,
      claim: s.candidateFacts.claim,
      metric: s.candidateFacts.metric,
      source: s.candidateFacts.source,
      verification: s.candidateFacts.verification,
    })
    .from(s.candidateFacts)
    .where(and(eq(s.candidateFacts.userId, userId), eq(s.candidateFacts.active, true)))
    .orderBy(asc(s.candidateFacts.sort), asc(s.candidateFacts.key));

  const [settings] = await db
    .select()
    .from(s.applicationSettings)
    .where(eq(s.applicationSettings.userId, userId));

  let job = {
    title: "",
    salaryMinUsd: null as number | null,
    salaryMaxUsd: null as number | null,
    salaryPeriod: null as string | null,
    salaryNote: null as string | null,
    weeklyHours: null as number | null,
  };
  if (jobId) {
    const [row] = await db
      .select({
        title: s.jobs.title,
        salaryMinUsd: s.jobs.salaryMinUsd,
        salaryMaxUsd: s.jobs.salaryMaxUsd,
        salaryPeriod: s.jobs.salaryPeriod,
        salaryNote: s.jobs.salaryNote,
        weeklyHours: s.jobs.weeklyHours,
      })
      .from(s.jobs)
      .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)));
    if (!row) throw new ApplicantFailure("job_not_found", jobId);
    job = row;
  }

  return {
    profile: {
      headline: p.headline,
      location: { city: p.locationCity, country: p.locationCountry },
      remote_only: p.remoteOnly,
      timezone: p.timezone,
      english_cefr: p.englishCefr,
      years_total: p.yearsTotal,
      years_enterprise: p.yearsEnterprise,
      work_auth: p.workAuth,
      max_weekly_hours: p.maxWeeklyHours,
      summary: p.profileSummary,
    },
    facts: facts.length > 0 ? facts : NO_FACTS,
    fixed_answers: settings
      ? {
          availability: settings.availability ?? NOT_LOADED,
          contract: settings.contract ?? NOT_LOADED,
          work_authorization: settings.workAuthorization ?? NOT_LOADED,
          links: settings.links,
        }
      : NO_FIXED_ANSWERS,
    salary: {
      ...salaryAsk(job, {
        profileFloorUsd: p.salaryFloorUsd,
        criteriaFloorUsd: criteria?.rules.salary_floor_usd_monthly ?? null,
      }),
      job_id: jobId,
    },
  };
}

export type BankAnswer = {
  id: string;
  question: string;
  answer: string;
  lang: string;
  source_job_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function listAnswers(
  db: Db,
  input: { userId: string; query?: string; lang?: AnswerLang; limit: number },
): Promise<BankAnswer[]> {
  const rows = await db
    .select()
    .from(s.answerBank)
    .where(
      and(
        eq(s.answerBank.userId, input.userId),
        input.lang ? eq(s.answerBank.lang, input.lang) : undefined,
      ),
    );
  return rankAnswers(rows, input.query, input.limit).map((r) => ({
    id: r.id,
    question: r.question,
    answer: r.answer,
    lang: r.lang,
    source_job_id: r.sourceJobId,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }));
}

/** Guarda una respuesta aprobada. La misma pregunta normalizada en el mismo idioma se reemplaza. */
export async function saveAnswer(
  db: Db,
  input: {
    userId: string;
    question: string;
    answer: string;
    lang: AnswerLang;
    jobId?: string | null;
    now?: () => Date;
  },
): Promise<{ id: string; replaced: boolean }> {
  const question = input.question.trim();
  const answer = input.answer.trim();
  const questionNormalized = normalizeQuestion(question);
  if (!questionNormalized || !answer) throw new ApplicantFailure("empty_question");
  const jobId = input.jobId ?? null;
  if (jobId && !(await jobExists(db, input.userId, jobId))) {
    throw new ApplicantFailure("job_not_found", jobId);
  }
  const now = input.now?.() ?? new Date();

  const [existing] = await db
    .select({ id: s.answerBank.id })
    .from(s.answerBank)
    .where(
      and(
        eq(s.answerBank.userId, input.userId),
        eq(s.answerBank.questionNormalized, questionNormalized),
        eq(s.answerBank.lang, input.lang),
      ),
    );
  if (existing) {
    await db
      .update(s.answerBank)
      .set({ question, answer, sourceJobId: jobId, updatedAt: now })
      .where(eq(s.answerBank.id, existing.id));
    return { id: existing.id, replaced: true };
  }
  const [created] = await db
    .insert(s.answerBank)
    .values({
      userId: input.userId,
      question,
      questionNormalized,
      answer,
      lang: input.lang,
      sourceJobId: jobId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: s.answerBank.id });
  return { id: created!.id, replaced: false };
}

/** Guarda el formulario respondido de una oferta. Reemplaza entero el anterior (idempotente). */
export async function saveApplicationAnswers(
  db: Db,
  input: { userId: string; jobId: string; qa: { question: string; answer: string }[] },
): Promise<{ job_id: string; saved: number; replaced: number }> {
  const qa = input.qa.map((x) => ({ question: x.question.trim(), answer: x.answer.trim() }));
  if (qa.length === 0) throw new ApplicantFailure("empty_form");
  if (qa.some((x) => !x.question || !x.answer)) throw new ApplicantFailure("empty_question");
  if (!(await jobExists(db, input.userId, input.jobId))) {
    throw new ApplicantFailure("job_not_found", input.jobId);
  }
  const where = and(
    eq(s.applicationAnswers.userId, input.userId),
    eq(s.applicationAnswers.jobId, input.jobId),
  );
  const [before] = await db.select({ n: count() }).from(s.applicationAnswers).where(where);
  await db.delete(s.applicationAnswers).where(where);
  await db.insert(s.applicationAnswers).values(
    qa.map((x, position) => ({
      userId: input.userId,
      jobId: input.jobId,
      position,
      question: x.question,
      answer: x.answer,
    })),
  );
  return { job_id: input.jobId, saved: qa.length, replaced: before?.n ?? 0 };
}
