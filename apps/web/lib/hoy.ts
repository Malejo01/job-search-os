import { createLogger } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import {
  DEFAULT_TIMEZONE,
  PRODUCT_NAME,
  buildDigest,
  digestSentence,
  visitWindow,
  type CareerMarket,
  type RoleKey,
} from "@job-search-os/pipeline";
import { getCareerMarket } from "./career-market";
import { withUser } from "./db";
import { getFitData } from "./fit";
import { countJobs, listJobs, type JobCounts, type JobListRow } from "./jobs";
import { getTargetRoles, hasReceivedEmail } from "./onboarding";
import { portalCoverage, type PortalCoverage } from "./portal-coverage";

const DAY_MS = 24 * 60 * 60 * 1000;

export type HoyCareer = { role: RoleKey; market: CareerMarket };

export type HoyData = {
  /** Desde cuándo se muestran las novedades; null = sin visita anterior (se usan los últimos 7 días). */
  since: Date | null;
  /** Valor nuevo de la cookie de visita, o null si no hay que reescribirla. */
  stamp: string | null;
  /** Ofertas evaluadas en la ventana, por score (hasta 100). */
  jobs: JobListRow[];
  coverage: PortalCoverage;
  roles: RoleKey[];
  careers: HoyCareer[];
  /** Solo cuando no hay ofertas nuevas: para elegir qué decir en el vacío. */
  empty: { counts: JobCounts; hasReceivedEmail: boolean } | null;
  /** Zona del perfil (o la del pipeline por defecto): con ella se formatean las fechas. */
  timeZone: string;
  /** La persona acepta ofertas solo en español (`jobLanguages` = ["es"]): habilita el puente de idioma. */
  onlySpanish: boolean;
  /** «En resumen» (C-6, canal A): una frase con conteos; null sin visita anterior o sin novedades. */
  digest: string | null;
  /** Titular de «Tu encaje» de la carrera principal; null si no hay carrera o el cálculo falló. */
  fit: { headline: string } | null;
};

/** El titular de «Tu encaje»: si falla, la tarjeta no se muestra y se loguea solo el usuario. */
async function fitForCard(userId: string, role: RoleKey | undefined, now: Date) {
  if (!role) return null;
  try {
    const fit = await getFitData(userId, role, now);
    return { headline: fit.summary.headline };
  } catch (err) {
    // Solo el tipo de error: el mensaje puede traer parámetros de la consulta
    const errName = err instanceof Error ? err.name : "desconocido";
    createLogger({ user_id: userId, task: "tu_encaje" }).error({ errName }, "tu encaje falló");
    return null;
  }
}

/**
 * Datos de «Hoy» (ronda 119): una `Promise.all` con RLS y el mercado cacheado. La ventana sale de
 * la cookie de visita (`visitWindow`); sin visita anterior, las evaluadas en los últimos 7 días.
 * `countJobs` y `hasReceivedEmail` se leen solo si no hay ofertas, para el mensaje del vacío.
 */
export async function getHoyData(
  userId: string,
  now: Date,
  cookieValue: string | undefined,
): Promise<HoyData> {
  const { since, stamp } = visitWindow(cookieValue, userId, now);
  const evaluatedSince = since ?? new Date(now.getTime() - 7 * DAY_MS);
  const [jobs, coverage, roles, profile] = await Promise.all([
    listJobs(
      userId,
      {
        scoreMin: null,
        source: null,
        status: null,
        since: null,
        periodo: null,
        duplicates: false,
      },
      { evaluatedSince, now },
    ),
    portalCoverage(userId, now),
    getTargetRoles(userId),
    // Una sola consulta al perfil: zona horaria e idiomas de las ofertas
    withUser(userId, async (tx) => {
      const [row] = await tx
        .select({ tz: s.profiles.timezone, languages: s.profiles.jobLanguages })
        .from(s.profiles)
        .limit(1);
      return { tz: row?.tz || DEFAULT_TIMEZONE, languages: row?.languages ?? [] };
    }),
  ]);
  const { tz: timeZone, languages } = profile;
  const onlySpanish = languages.includes("es") && !languages.includes("en");
  const [careers, empty, fit] = await Promise.all([
    Promise.all(roles.map(async (role) => ({ role, market: await getCareerMarket(role) }))),
    jobs.length === 0
      ? Promise.all([countJobs(userId), hasReceivedEmail(userId)]).then(([counts, received]) => ({
          counts,
          hasReceivedEmail: received,
        }))
      : Promise.resolve(null),
    fitForCard(userId, roles[0], now),
  ]);
  // Solo con una visita anterior: la frase dice «desde tu última visita». Seguimientos: pendiente (C-9)
  const digest = since
    ? digestSentence(
        buildDigest({
          newEvaluated: jobs.length,
          toApply: jobs.filter(
            (j) => j.accion === "aplicar" || j.accion === "aplicar_personalizado",
          ).length,
          followUps: 0,
          careers: [],
          frequency: "diario",
          now,
          timeZone,
          productName: PRODUCT_NAME,
        }),
      )
    : null;
  return {
    since,
    stamp,
    jobs,
    coverage,
    roles,
    careers,
    empty,
    timeZone,
    onlySpanish,
    digest,
    fit,
  };
}
