import { foldText } from "../../normalize/text";
import type { SourceKind } from "../../raw-job";
import { ROLE_KEYS, type RoleKey } from "../../skills/self-assessment";
import { allowsCountry, locationScope } from "../location-scope";

/**
 * Vitrina pública (ronda 63): números del pool y selección de avisos de muestra. Puro: recibe
 * filas planas y la hora, devuelve datos. Solo usa lo que ya es público (`public_jobs`).
 */

/** Un aviso está activo si no es copia (`dedup_of_id` null) y se vio en los últimos 7 días. */
export const SHOWCASE_ACTIVE_DAYS = 7;
export const SHOWCASE_NEW_HOURS = 24;
export const SHOWCASE_TOP_COMPANIES = 10;
export const SHOWCASE_MAX_SKILLS = 5;
/** País que se evalúa en "acepta Argentina o LATAM". */
export const SHOWCASE_HOME_COUNTRY = "AR";

/** Un grupo con menos avisos que esto no entra al top de empresas. */
export const SHOWCASE_TOP_MIN_JOBS = 5;
/** /ofertas solo muestra avisos vistos en las últimas 72 h (Jobicy exige no mostrar cerrados). */
export const SHOWCASE_OFFERS_FRESH_HOURS = 72;

/**
 * LISTA DE PERMITIDOS de la vitrina (ni /ofertas ni los números ni el top de empresas usan otras).
 * Sale de fuentes.md de la ronda 63: We Work Remotely queda afuera y una fuente nueva no entra sola.
 */
export const SHOWCASE_SOURCES: readonly SourceKind[] = [
  "getonboard_api",
  "remoteok",
  "jobicy",
  "greenhouse",
  "lever",
  "ashby",
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Ventana de "visto hace poco" de /ofertas, en ms. */
export const SHOWCASE_OFFERS_FRESH_MS = SHOWCASE_OFFERS_FRESH_HOURS * HOUR_MS;

/** Ventana de "activo" en ms, para que el adaptador y el cálculo usen la misma. */
export const SHOWCASE_ACTIVE_MS = SHOWCASE_ACTIVE_DAYS * DAY_MS;

export type ShowcasePoolRow = {
  roleHints: readonly string[];
  modality: string | null;
  countriesAllowed: readonly string[] | null;
  locationRaw: string | null;
  companyRaw: string;
  sourceKind: string;
  /** ISO */
  firstSeenAt: string;
};

/** Filas ya filtradas por el adaptador (activas, sin copias, solo fuentes de `SHOWCASE_SOURCES`). */
export type PoolShowcaseInput = {
  jobs: readonly ShowcasePoolRow[];
  /** max(last_seen_at) de todo el pool, ISO. */
  poolUpdatedAt: string | null;
  /** ISO */
  now: string;
};

export type PoolShowcase = {
  active: number;
  sources: number;
  new24h: number;
  /** Horas enteras desde la última actualización del pool; null si no se sabe. */
  updatedHoursAgo: number | null;
  /** Carreras con ofertas remotas, de mayor a menor (desempata por orden de `ROLE_KEYS`). */
  remoteByRole: { role: RoleKey; remote: number }[];
  /** Alcance geográfico de las ofertas activas respecto de Argentina/LATAM. */
  argentina: { accepts: number; excludes: number; unknown: number };
  /** Empresas con más avisos en la muestra (mínimo `SHOWCASE_TOP_MIN_JOBS`), con el nombre del aviso. */
  topCompanies: { company: string; jobs: number }[];
  /** Cuándo se calculó (ISO); el tamaño de la muestra es `active`. */
  computedAt: string;
};

const ROLE_SET: ReadonlySet<string> = new Set(ROLE_KEYS);

function topCompanies(rows: readonly ShowcasePoolRow[]): PoolShowcase["topCompanies"] {
  const groups = new Map<string, { counts: Map<string, number>; total: number }>();
  for (const r of rows) {
    const name = r.companyRaw.replace(/\s+/g, " ").trim();
    const key = foldText(name);
    if (!key) continue;
    const g = groups.get(key) ?? { counts: new Map(), total: 0 };
    g.counts.set(name, (g.counts.get(name) ?? 0) + 1);
    g.total += 1;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.total >= SHOWCASE_TOP_MIN_JOBS)
    .map((g) => {
      // Escritura más frecuente del nombre; desempata alfabéticamente
      const [company] = [...g.counts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]!;
      return { company, jobs: g.total };
    })
    .sort((a, b) => b.jobs - a.jobs || a.company.localeCompare(b.company))
    .slice(0, SHOWCASE_TOP_COMPANIES);
}

export function buildPoolShowcase(input: PoolShowcaseInput): PoolShowcase {
  const now = Date.parse(input.now);
  const remote = new Map<RoleKey, number>();
  const argentina = { accepts: 0, excludes: 0, unknown: 0 };
  const kinds = new Set<string>();
  let new24h = 0;

  for (const j of input.jobs) {
    kinds.add(j.sourceKind);
    if (now - Date.parse(j.firstSeenAt) < SHOWCASE_NEW_HOURS * HOUR_MS) new24h += 1;
    if (j.modality === "remoto") {
      for (const hint of new Set(j.roleHints)) {
        if (ROLE_SET.has(hint)) remote.set(hint as RoleKey, (remote.get(hint as RoleKey) ?? 0) + 1);
      }
    }
    const scope = locationScope(j.locationRaw, j.countriesAllowed);
    if (scope.kind === "unknown") argentina.unknown += 1;
    else if (allowsCountry(scope, SHOWCASE_HOME_COUNTRY)) argentina.accepts += 1;
    else argentina.excludes += 1;
  }

  const hours = input.poolUpdatedAt
    ? Math.max(0, Math.floor((now - Date.parse(input.poolUpdatedAt)) / HOUR_MS))
    : null;

  return {
    active: input.jobs.length,
    sources: kinds.size,
    new24h,
    updatedHoursAgo: hours,
    remoteByRole: ROLE_KEYS.map((role) => ({ role, remote: remote.get(role) ?? 0 }))
      .filter((r) => r.remote > 0)
      .sort((a, b) => b.remote - a.remote),
    argentina,
    topCompanies: topCompanies(input.jobs),
    computedAt: input.now,
  };
}

export type ShowcaseJobRow = {
  id: string;
  title: string;
  companyRaw: string;
  locationRaw: string | null;
  modality: string | null;
  sourceKind: string;
  sourceUrl: string;
  /** ISO: posted_at o, si falta, first_seen_at. */
  publishedAt: string;
  skills: { name: string; isMust: boolean }[];
};

export type ShowcaseCard = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  modality: string | null;
  publishedAt: string;
  /** Hasta `SHOWCASE_MAX_SKILLS`, primero las excluyentes. */
  skills: string[];
  sourceKind: string;
  /** Tal como la da la fuente: quien la muestra la valida (http/https) con `safeHttpUrl` de la web. */
  sourceUrl: string;
};

function cardSkills(skills: ShowcaseJobRow["skills"]): string[] {
  const seen = new Set<string>();
  const ordered = [...skills.filter((k) => k.isMust), ...skills.filter((k) => !k.isMust)];
  const out: string[] = [];
  for (const k of ordered) {
    if (seen.has(k.name)) continue;
    seen.add(k.name);
    out.push(k.name);
    if (out.length === SHOWCASE_MAX_SKILLS) break;
  }
  return out;
}

/** Orden por fecha (más nuevo primero, desempata por id), tope y forma de cada tarjeta. */
export function pickShowcaseJobs(rows: readonly ShowcaseJobRow[], limit: number): ShowcaseCard[] {
  return [...rows]
    .sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, limit))
    .map((r) => ({
      id: r.id,
      title: r.title,
      company: r.companyRaw,
      location: r.locationRaw?.trim() || null,
      modality: r.modality,
      publishedAt: r.publishedAt,
      skills: cardSkills(r.skills),
      sourceKind: r.sourceKind,
      sourceUrl: r.sourceUrl,
    }));
}
