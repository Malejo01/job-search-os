import { readCareerRevealCounts } from "@job-search-os/adapters";
import type { Db } from "@job-search-os/db";
import {
  CAREER_VISIBILITY_OVERRIDES,
  buildCareerRevealRows,
  parseBetaMetrics,
  parseFounderCounts,
  publicCareerKeys,
  watchedCareerKeys,
  type BetaMetrics,
  type CareerRevealRow,
  type FounderCountRow,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Métricas de la beta (C-14), solo servidor y solo admins. Dos barreras, como la lista de espera:
 * ADMIN_EMAILS acá y `app_admins` en la base (`admin_beta_metrics()`, rls/0009). La base devuelve
 * solo agregados con k-anonimato sobre personas; acá se validan y nada más.
 */
export type BetaMetricsResult =
  | { ok: true; metrics: BetaMetrics }
  | { ok: false; reason: "no_admin" | "no_habilitado" | "sin_datos" };

export type FounderCountsResult =
  | { ok: true; rows: FounderCountRow[] }
  | { ok: false; reason: "no_admin" | "no_habilitado" | "sin_datos" };

/**
 * Cupos de fundador por carrera (C-13b), mismas dos barreras que las métricas. La base cuenta
 * personas con plan fundador vigente por su carrera principal (`admin_founder_counts`, rls/0012) y
 * enmascara los grupos de menos de 3; las claves válidas están fijas en el SQL. Acá solo se valida la forma.
 * Si la función no está aplicada en la base, vuelve `sin_datos` («falta aplicar la migración»).
 */
export async function getFounderCounts(userId: string): Promise<FounderCountsResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const raw = (await withUser(userId, (tx) =>
      tx.execute(sql`select role, people from admin_founder_counts()`),
    )) as unknown as { role: string; people: number | null }[];
    const rows = parseFounderCounts(Array.from(raw));
    return rows ? { ok: true, rows } : { ok: false, reason: "sin_datos" };
  } catch (error) {
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("admin_founder_counts: no autorizado")) {
        return { ok: false, reason: "no_habilitado" };
      }
    }
    return { ok: false, reason: "sin_datos" };
  }
}

export async function getBetaMetrics(userId: string): Promise<BetaMetricsResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const [row] = (await withUser(userId, (tx) =>
      tx.execute(sql`select admin_beta_metrics() as m`),
    )) as unknown as { m: unknown }[];
    const metrics = parseBetaMetrics(row?.m);
    return metrics ? { ok: true, metrics } : { ok: false, reason: "sin_datos" };
  } catch (error) {
    // Admin en ADMIN_EMAILS sin fila en app_admins, o la función todavía sin aplicar en la base
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("admin_beta_metrics: no autorizado")) {
        return { ok: false, reason: "no_habilitado" };
      }
    }
    return { ok: false, reason: "sin_datos" };
  }
}

/** Una carrera vigilada: su conteo (el de ADR-022) y si hoy se muestra en público (ADR-029). */
export type CareerVisibilityRow = CareerRevealRow & {
  /** Hoy aparece en los chips, el sitemap y /mercado. */
  shown: boolean;
  /** Está en la lista de «siempre oculta» (`CAREER_VISIBILITY_OVERRIDES`): el umbral no la muestra. */
  forcedHidden: boolean;
};

export type CareerRevealResult =
  { ok: true; rows: CareerVisibilityRow[] } | { ok: false; reason: "no_admin" | "sin_datos" };

/**
 * Carreras de la beta y cuántas ofertas tienen (C4-3, ADR-029), solo admins. Una consulta agregada a
 * `public_jobs` (que la app ya lee): vuelven números por carrera, ningún aviso. Desde ADR-029 la carrera
 * se muestra sola al llegar al umbral; esta tabla dice cuáles se muestran hoy y cuánto falta a las demás.
 */
export async function getCareerReveal(userId: string): Promise<CareerRevealResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const watched = watchedCareerKeys();
    const counts = await withUser(userId, (tx) =>
      readCareerRevealCounts(tx as unknown as Db, watched, new Date()),
    );
    const shown = new Set<string>(publicCareerKeys(counts));
    const rows = buildCareerRevealRows(watched, counts).map((row) => ({
      ...row,
      shown: shown.has(row.role),
      forcedHidden: CAREER_VISIBILITY_OVERRIDES.alwaysHidden.some((k) => k === row.role),
    }));
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: "sin_datos" };
  }
}
