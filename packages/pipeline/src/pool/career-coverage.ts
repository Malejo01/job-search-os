import { acceptsCountry } from "../listing/countries-accepted";
import { isEntryLevel } from "../listing/entry-level";
import { locationScope } from "./location-scope";

/**
 * Cobertura por carrera para abrir la beta (R32-02). Puro: recibe filas del pool que ya leyó la app y
 * la fecha de hoy; no lee la base, no mira el reloj y no conoce personas (el pool es global).
 *
 * Tres definiciones, las mismas que usan el panel `/admin/cobertura` y el alta por carrera:
 * - **Vigente:** una fuente mostró el aviso en los últimos 7 días (`last_seen_at`).
 * - **Tomable:** el aviso acepta Argentina, su región o todo el mundo de forma **explícita** en
 *   `countries_allowed`, o el lugar de trabajo está en Argentina. Si no dice países, no cuenta: nunca se
 *   asume «cualquier país». Misma regla que «Aceptan {tu país}» (R30-05) más el lugar de trabajo.
 * - **Para quien empieza:** la señal del chip «Para empezar» (R30-05, `isEntryLevel`): nivel trainee,
 *   pasante o junior. En el panel solo cuenta entre las **tomables**: una oferta junior que no acepta
 *   Argentina no le sirve a nadie de la beta.
 *
 * El semáforo es informativo: nada abre solo, el responsable decide.
 */

export const COVERAGE_VIGENTE_DAYS = 7;
export const COVERAGE_TREND_DAYS = 14;
/** Para abrir una carrera: al menos estas ofertas tomables vigentes... */
export const COVERAGE_TOMABLE_THRESHOLD = 30;
/** ...y al menos estas para quien empieza. */
export const COVERAGE_ENTRY_THRESHOLD = 10;

const DAY_MS = 86_400_000;

const validDate = (d: Date | null | undefined): d is Date =>
  d instanceof Date && Number.isFinite(d.getTime());

/** ¿Una fuente mostró el aviso en los últimos 7 días? Sin fecha válida, no (falla cerrado). */
export function isVigente(lastSeenAt: Date | null | undefined, now: Date): boolean {
  if (!validDate(lastSeenAt) || !validDate(now)) return false;
  return now.getTime() - lastSeenAt.getTime() <= COVERAGE_VIGENTE_DAYS * DAY_MS;
}

export type TomableInput = {
  /** `public_jobs.countries_allowed`; null o vacío = la fuente no lo dice. */
  countriesAllowed: readonly string[] | null | undefined;
  /** Texto de la ubicación del aviso (`location_raw`). Solo cuenta si nombra Argentina. */
  locationRaw?: string | null;
  /** País del lugar de trabajo en ISO-2, si la fuente lo da. */
  locationCountry?: string | null;
};

/** Argentina, su región o todo el mundo explícitos, o lugar de trabajo en Argentina. Ver arriba. */
export function isTomable(input: TomableInput): boolean {
  if (acceptsCountry(input.countriesAllowed, "AR")) return true;
  if (input.locationCountry?.trim().toUpperCase() === "AR") return true;
  const raw = input.locationRaw?.trim();
  if (!raw) return false;
  // Solo el país nombrado: «Remoto, LATAM» (una región) no dice que el lugar de trabajo sea Argentina
  const scope = locationScope(raw, null);
  return scope.kind === "places" && scope.countries.includes("AR");
}

export type ParaEmpezarInput = { seniority: string | null | undefined; title: string };

/** La misma señal que el chip «Para empezar» de la R30. */
export function isParaEmpezar(input: ParaEmpezarInput): boolean {
  return isEntryLevel(input.seniority, input.title);
}

export type CoverageSemaphore = "verde" | "amarillo" | "rojo";

/**
 * Verde: los dos umbrales cumplidos (30 tomables y 10 para quien empieza). Amarillo: los dos a mitad de
 * camino o más. Rojo: el resto. Es una lectura para decidir, no abre ni cierra nada.
 */
export function coverageSemaphore(counts: {
  tomables: number;
  paraEmpezar: number;
}): CoverageSemaphore {
  const { tomables, paraEmpezar } = counts;
  if (tomables >= COVERAGE_TOMABLE_THRESHOLD && paraEmpezar >= COVERAGE_ENTRY_THRESHOLD) {
    return "verde";
  }
  if (tomables >= COVERAGE_TOMABLE_THRESHOLD / 2 && paraEmpezar >= COVERAGE_ENTRY_THRESHOLD / 2) {
    return "amarillo";
  }
  return "rojo";
}

/** Lo mínimo que se lee de un aviso del pool (sin copias) para armar la cobertura. Ningún texto largo. */
export type CoverageJob = {
  roleHints: readonly string[];
  sourceKind: string;
  countriesAllowed: readonly string[] | null;
  locationRaw: string | null;
  locationCountry?: string | null;
  seniority: string | null;
  title: string;
  /** Idioma del aviso: el calculado y, si falta, el que declara la fuente. Sin dato, null (no cuenta). */
  language: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type CoverageSource = { source: string; vigentes: number; tomables: number };

export type CoverageTrend = {
  /** Tomables nuevas (primera vez vistas) por día; 14 posiciones, la última es el día más reciente. */
  porDia: number[];
  ultimos7: number;
  previos7: number;
};

export type CareerCoverageRow = {
  role: string;
  vigentes: number;
  tomables: number;
  /** Entre las tomables. */
  paraEmpezar: number;
  /** Entre las vigentes. Sin idioma conocido no cuenta: el número es un piso. */
  enEspanol: number;
  /** Por fuente, de más a menos tomables; empate, por nombre. */
  sources: CoverageSource[];
  semaforo: CoverageSemaphore;
  /** null si el pool de la carrera no tiene 14 días de historia: los datos no alcanzan. */
  trend: CoverageTrend | null;
};

/**
 * Una fila por carrera de `roles`, en ese orden, también las que no tienen ofertas (en cero y rojas).
 * Una oferta con varias carreras cuenta una vez en cada una. Los avisos de otras carreras se ignoran.
 * `jobs` debe venir sin copias (`dedup_of_id` nulo).
 */
export function careerCoverage(
  roles: readonly string[],
  jobs: readonly CoverageJob[],
  now: Date,
): CareerCoverageRow[] {
  return roles.map((role) => {
    let vigentes = 0;
    let tomables = 0;
    let paraEmpezar = 0;
    let enEspanol = 0;
    const bySource = new Map<string, CoverageSource>();
    const porDia = new Array<number>(COVERAGE_TREND_DAYS).fill(0);
    let hasHistory = false;

    for (const j of jobs) {
      if (!j.roleHints.includes(role)) continue;
      const tomable = isTomable(j);
      if (validDate(j.firstSeenAt) && validDate(now)) {
        const age = now.getTime() - j.firstSeenAt.getTime();
        if (age >= COVERAGE_TREND_DAYS * DAY_MS) hasHistory = true;
        if (tomable && age >= 0 && age < COVERAGE_TREND_DAYS * DAY_MS) {
          porDia[COVERAGE_TREND_DAYS - 1 - Math.floor(age / DAY_MS)]! += 1;
        }
      }
      if (!isVigente(j.lastSeenAt, now)) continue;
      vigentes += 1;
      if (j.language === "es") enEspanol += 1;
      const src = bySource.get(j.sourceKind) ?? { source: j.sourceKind, vigentes: 0, tomables: 0 };
      src.vigentes += 1;
      if (tomable) {
        tomables += 1;
        src.tomables += 1;
        if (isParaEmpezar(j)) paraEmpezar += 1;
      }
      bySource.set(j.sourceKind, src);
    }

    const sources = [...bySource.values()].sort(
      (a, b) => b.tomables - a.tomables || a.source.localeCompare(b.source),
    );
    const half = Math.floor(COVERAGE_TREND_DAYS / 2);
    const trend: CoverageTrend | null = hasHistory
      ? {
          porDia,
          ultimos7: porDia.slice(half).reduce((a, b) => a + b, 0),
          previos7: porDia.slice(0, half).reduce((a, b) => a + b, 0),
        }
      : null;
    return {
      role,
      vigentes,
      tomables,
      paraEmpezar,
      enEspanol,
      sources,
      semaforo: coverageSemaphore({ tomables, paraEmpezar }),
      trend,
    };
  });
}
