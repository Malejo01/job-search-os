import { visitWindow, type CareerMarket, type RoleKey } from "@job-search-os/pipeline";
import { getCareerMarket } from "./career-market";
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
};

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
  const [jobs, coverage, roles] = await Promise.all([
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
  ]);
  const [careers, empty] = await Promise.all([
    Promise.all(roles.map(async (role) => ({ role, market: await getCareerMarket(role) }))),
    jobs.length === 0
      ? Promise.all([countJobs(userId), hasReceivedEmail(userId)]).then(([counts, received]) => ({
          counts,
          hasReceivedEmail: received,
        }))
      : Promise.resolve(null),
  ]);
  return { since, stamp, jobs, coverage, roles, careers, empty };
}
