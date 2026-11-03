import { schema as s, type Db } from "@job-search-os/db";
import {
  isEnglishLevel,
  type CareerMarketInput,
  type CareerSalaryJob,
  type JobLanguageFacts,
  type RoleKey,
} from "@job-search-os/pipeline";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * Mercado por carrera (ronda 58): lectura de lo que necesita `buildCareerMarket`. Solo
 * `public_jobs`, `public_job_skills` y `skills`: ninguna tabla de usuarios. El cálculo es puro y
 * vive en el pipeline; acá solo se trae la ventana de avisos del rol. `db` puede ser una transacción.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ventana de avisos activos de una carrera. */
export const CAREER_MARKET_WINDOW_DAYS = 30;
/** Tope de caracteres del texto del aviso que se trae de la base. */
const JD_MAX_CHARS = 30000;

export async function readCareerMarketInput(
  db: Db,
  role: RoleKey,
  now: Date,
  /**
   * C8-15: con las columnas de idioma (migración 0058, `PUBLIC_JOBS_LANGUAGE_ENABLED=1`) el texto del
   * aviso solo se trae para las filas que todavía no tienen el idioma calculado.
   */
  opts: { persistedLanguage?: boolean } = {},
): Promise<CareerMarketInput> {
  const since = new Date(now.getTime() - CAREER_MARKET_WINDOW_DAYS * DAY_MS);
  // Avisos del rol: sin copias, vistos por última vez dentro de la ventana
  const roleJobs = and(
    isNull(s.publicJobs.dedupOfId),
    sql`${s.publicJobs.lastSeenAt} >= ${since.toISOString()}::timestamptz`,
    sql`${s.publicJobs.roleHints} @> ARRAY[${role}]::text[]`,
  );

  const jobRows = await db
    .select({
      id: s.publicJobs.id,
      title: s.publicJobs.title,
      seniority: s.publicJobs.seniority,
      lang: s.publicJobs.lang,
      salaryMinUsd: s.publicJobs.salaryMinUsd,
      salaryMaxUsd: s.publicJobs.salaryMaxUsd,
      salaryPeriod: s.publicJobs.salaryPeriod,
      modality: s.publicJobs.modality,
      countriesAllowed: s.publicJobs.countriesAllowed,
      locationRaw: s.publicJobs.locationRaw,
      sourceKind: s.publicJobs.sourceKind,
      publishedAt: sql<Date>`coalesce(${s.publicJobs.postedAt}, ${s.publicJobs.firstSeenAt})`,
      // Acotado: solo se lee para detectar inglés; un aviso gigante no debe inflar la lectura. Con el
      // idioma persistido (C8-15), solo para las filas que el relleno todavía no alcanzó
      jdText: opts.persistedLanguage
        ? sql<
            string | null
          >`case when ${s.publicJobs.languageCheckedAt} is null or ${s.publicJobs.languageCheckedAt} < ${s.publicJobs.updatedAt} then left(${s.publicJobs.jdText}, ${JD_MAX_CHARS}) end`
        : sql<string | null>`left(${s.publicJobs.jdText}, ${JD_MAX_CHARS})`,
      ...(opts.persistedLanguage
        ? {
            checkedAt: s.publicJobs.languageCheckedAt,
            contentUpdatedAt: s.publicJobs.updatedAt,
            jdLanguage: s.publicJobs.jdLanguage,
            englishLanguage: s.publicJobs.englishLanguage,
            englishAsks: s.publicJobs.englishAsks,
            englishLevel: s.publicJobs.englishLevel,
          }
        : {}),
    })
    .from(s.publicJobs)
    .where(roleJobs);

  const skillRows = jobRows.length
    ? await db
        .select({
          jobId: s.publicJobSkills.publicJobId,
          slug: s.skills.slug,
          name: s.skills.name,
          isMust: s.publicJobSkills.isMust,
        })
        .from(s.publicJobSkills)
        .innerJoin(s.publicJobs, eq(s.publicJobs.id, s.publicJobSkills.publicJobId))
        .innerJoin(s.skills, eq(s.skills.id, s.publicJobSkills.skillId))
        .where(roleJobs)
    : [];

  // max(last_seen_at) de todo el pool: lo resuelve el índice public_jobs_last_seen
  const [pool] = await db
    .select({ last: sql<Date | string | null>`max(${s.publicJobs.lastSeenAt})` })
    .from(s.publicJobs);

  return {
    role,
    jobs: jobRows.map((row) => {
      const {
        checkedAt,
        contentUpdatedAt,
        jdLanguage,
        englishLanguage,
        englishAsks,
        englishLevel,
        ...j
      } = row as typeof row & PersistedLanguageRow;
      // R-5: si el aviso cambió después de calcular el idioma, el dato está vencido y se usa el texto
      const fresh =
        checkedAt && contentUpdatedAt
          ? new Date(checkedAt).getTime() >= new Date(contentUpdatedAt).getTime()
          : Boolean(checkedAt);
      return {
        ...j,
        publishedAt: toIso(j.publishedAt),
        language: fresh
          ? toLanguageFacts({ jdLanguage, englishLanguage, englishAsks, englishLevel })
          : null,
      };
    }),
    skills: skillRows,
    poolUpdatedAt: pool?.last ? toIso(pool.last) : null,
    now: now.toISOString(),
  };
}

type PersistedLanguageRow = {
  checkedAt?: Date | null;
  contentUpdatedAt?: Date | null;
  jdLanguage?: string | null;
  englishLanguage?: string | null;
  englishAsks?: boolean | null;
  englishLevel?: string | null;
};

/** Valida lo que vuelve de las columnas; un valor desconocido se trata como «no se sabe». */
function toLanguageFacts(
  r: Omit<PersistedLanguageRow, "checkedAt" | "contentUpdatedAt">,
): JobLanguageFacts {
  const jd = r.jdLanguage;
  const en = r.englishLanguage;
  return {
    jdLanguage: jd === "es" || jd === "en" || jd === "pt" ? jd : null,
    englishLanguage: en === "en" || en === "es" ? en : null,
    englishAsks: r.englishAsks === true,
    englishLevel: isEnglishLevel(r.englishLevel) ? r.englishLevel : null,
  };
}

/**
 * Sueldos de todas las carreras en una sola consulta (sin texto del aviso ni skills): los avisos
 * de la ventana con sus `role_hints`, para que el llamador agrupe por carrera.
 */
export async function readCareerSalaryJobs(
  db: Db,
  now: Date,
): Promise<{ roleHints: string[]; job: CareerSalaryJob }[]> {
  const since = new Date(now.getTime() - CAREER_MARKET_WINDOW_DAYS * DAY_MS);
  const rows = await db
    .select({
      title: s.publicJobs.title,
      seniority: s.publicJobs.seniority,
      salaryMinUsd: s.publicJobs.salaryMinUsd,
      salaryMaxUsd: s.publicJobs.salaryMaxUsd,
      salaryPeriod: s.publicJobs.salaryPeriod,
      countriesAllowed: s.publicJobs.countriesAllowed,
      locationRaw: s.publicJobs.locationRaw,
      roleHints: s.publicJobs.roleHints,
    })
    .from(s.publicJobs)
    .where(
      and(
        isNull(s.publicJobs.dedupOfId),
        sql`${s.publicJobs.lastSeenAt} >= ${since.toISOString()}::timestamptz`,
      ),
    );
  return rows.map(({ roleHints, ...job }) => ({
    roleHints: roleHints ?? [],
    job,
  }));
}

/** `sql<Date>` no pasa por el mapeo de drizzle: el driver puede devolver Date o texto. */
function toIso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}
