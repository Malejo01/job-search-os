import { isParaEmpezar, isTomable, isVigente } from "./career-coverage";
import { summarizeSalaries } from "./career/salary";
import { locationScope } from "./location-scope";
import { monthlyUsd } from "./monthly-usd";
import type { SalaryOriginal } from "../salary-original";

/**
 * `/market` mínimo (R34-03). Puro: recibe los avisos del pool de la carrera ya leídos, las habilidades que
 * piden y las que la persona tiene cargadas, y la fecha de hoy; no lee la base ni mira el reloj.
 *
 * Responde pocas preguntas y solo con avisos **vigentes** (vistos en los últimos 7 días), con las mismas
 * definiciones de vigente, tomable y «para quien empieza» que la cobertura (R32-02, `career-coverage.ts`):
 * - cuántas ofertas hay, cuántas puede tomar la persona desde su país y cuántas son para quien empieza
 *   (entre las tomables, igual que el panel de cobertura);
 * - qué habilidades piden más y cuáles de esas ya tiene cargadas;
 * - en qué modalidad y desde dónde se puede trabajar;
 * - qué sueldos se publican, **en la moneda original** (R32-08), sin convertir ni mezclar monedas y solo
 *   con casos suficientes.
 *
 * Cada dato lleva de cuántos avisos sale (`vigentes`) y de qué fecha es (`asOf`).
 */

/** Con menos avisos que esto no hay gráfico: «todavía hay pocos datos». Igual que el mínimo de sueldos. */
export const MARKET_MIN_JOBS = 10;
/** Filas de habilidades que se muestran. */
export const MARKET_TOP_SKILLS = 8;

export type MarketMinimalJob = {
  id: string;
  title: string;
  seniority: string | null;
  modality: string | null;
  countriesAllowed: readonly string[] | null;
  locationRaw: string | null;
  lastSeenAt: Date;
  salaryOriginal: SalaryOriginal | null;
};

export type MarketMinimalSkill = { jobId: string; slug: string; name: string; isMust: boolean };

export type MarketMinimalInput = {
  /** Avisos del pool de la carrera, sin copias. Los que no son vigentes se ignoran. */
  jobs: readonly MarketMinimalJob[];
  skills: readonly MarketMinimalSkill[];
  /** Slugs de las habilidades que la persona tiene cargadas. */
  userSkills: readonly string[];
  now: Date;
};

export type MarketMinimalSkillRow = {
  slug: string;
  name: string;
  /** Avisos vigentes que la piden (excluyente o deseable), una vez por aviso. */
  jobs: number;
  /** jobs / vigentes, entre 0 y 1. */
  share: number;
  have: boolean;
};

export type MarketMinimalSalaryGroup = {
  currency: string;
  /** Avisos con sueldo en esa moneda y con período dicho (de acá salen los números). */
  informed: number;
  /** Siempre por mes: lo anual y lo por hora se pasa a mes. */
  period: "mensual";
  p25: number;
  median: number;
  p75: number;
};

export type MarketMinimal = {
  /** ISO del momento del cálculo. */
  asOf: string;
  vigentes: number;
  tomables: number;
  /** Entre las tomables. */
  paraEmpezar: number;
  /** Con menos de `MARKET_MIN_JOBS` vigentes no hay gráfico. */
  enoughForChart: boolean;
  skills: MarketMinimalSkillRow[];
  /** Cuántas de las habilidades mostradas ya tiene cargadas. */
  skillsHave: number;
  modality: Record<"remoto" | "hibrido" | "presencial" | "desconocida", number>;
  /** Desde dónde: acepta el país de la persona (Argentina), no lo dice, o es de otros países. */
  origin: { tomable: number; noDice: number; otros: number };
  salary: {
    /** Avisos vigentes con sueldo legible (moneda, monto y período). */
    withSalary: number;
    /** Solo las monedas con `MARKET_MIN_JOBS` casos o más, de más a menos casos. */
    groups: MarketMinimalSalaryGroup[];
    /** Monedas con sueldos publicados pero sin casos suficientes para decir nada. */
    hiddenCurrencies: number;
  };
};

export function buildMarketMinimal(input: MarketMinimalInput): MarketMinimal {
  const { now } = input;
  const jobs = input.jobs.filter((j) => isVigente(j.lastSeenAt, now));
  const vigentes = jobs.length;
  const ids = new Set(jobs.map((j) => j.id));

  let tomables = 0;
  let paraEmpezar = 0;
  const modality = { remoto: 0, hibrido: 0, presencial: 0, desconocida: 0 };
  const origin = { tomable: 0, noDice: 0, otros: 0 };
  const byCurrency = new Map<string, number[]>();
  let withSalary = 0;

  for (const j of jobs) {
    const tomable = isTomable(j);
    if (tomable) {
      tomables += 1;
      origin.tomable += 1;
      if (isParaEmpezar(j)) paraEmpezar += 1;
    } else if (locationScope(j.locationRaw, j.countriesAllowed ?? null).kind === "unknown") {
      origin.noDice += 1;
    } else {
      origin.otros += 1;
    }
    const m = j.modality;
    modality[m === "remoto" || m === "hibrido" || m === "presencial" ? m : "desconocida"] += 1;

    const sal = j.salaryOriginal;
    if (sal && sal.period) {
      const values = [sal.min, sal.max].filter((v): v is number => v !== null);
      if (values.length) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const point = monthlyUsd(avg, sal.period);
        if (point !== null) {
          withSalary += 1;
          const list = byCurrency.get(sal.currency) ?? [];
          list.push(point);
          byCurrency.set(sal.currency, list);
        }
      }
    }
  }

  // Habilidades: una vez por aviso, solo de avisos vigentes
  const perSkill = new Map<string, { name: string; jobIds: Set<string> }>();
  for (const s of input.skills) {
    if (!ids.has(s.jobId)) continue;
    const entry = perSkill.get(s.slug) ?? { name: s.name, jobIds: new Set<string>() };
    entry.jobIds.add(s.jobId);
    perSkill.set(s.slug, entry);
  }
  const mine = new Set(input.userSkills);
  const skills = [...perSkill.entries()]
    .map(([slug, e]) => ({
      slug,
      name: e.name,
      jobs: e.jobIds.size,
      share: vigentes ? e.jobIds.size / vigentes : 0,
      have: mine.has(slug),
    }))
    .sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name))
    .slice(0, MARKET_TOP_SKILLS);

  const groups: MarketMinimalSalaryGroup[] = [];
  let hiddenCurrencies = 0;
  for (const [currency, points] of byCurrency) {
    const sum = summarizeSalaries(points, points.length);
    if (!sum.enough || sum.p25 === null || sum.median === null || sum.p75 === null) {
      hiddenCurrencies += 1;
      continue;
    }
    groups.push({
      currency,
      informed: sum.informed,
      period: "mensual",
      p25: sum.p25,
      median: sum.median,
      p75: sum.p75,
    });
  }
  groups.sort((a, b) => b.informed - a.informed || a.currency.localeCompare(b.currency));

  return {
    asOf: now.toISOString(),
    vigentes,
    tomables,
    paraEmpezar,
    enoughForChart: vigentes >= MARKET_MIN_JOBS,
    skills,
    skillsHave: skills.filter((s) => s.have).length,
    modality,
    origin,
    salary: { withSalary, groups, hiddenCurrencies },
  };
}
