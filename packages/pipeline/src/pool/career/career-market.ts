import { SOURCE_ATTRIBUTION } from "../attribution";
import { allowsCountry, locationScope } from "../location-scope";
import { roleDemand } from "../role-demand";
import { detectEnglish, ENGLISH_ESTIMATED } from "./english";
import { monthlySalaryPoint, summarizeSalaries } from "./salary";
import { seniorityBucket } from "./seniority-bucket";
import type { CareerMarket, CareerMarketInput, EnglishLevel, SeniorityBucket } from "./types";

/** Debajo de esta cantidad de avisos la UI avisa que la muestra es chica. */
export const SMALL_SAMPLE_JOBS = 20;
export const TOP_SKILLS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const ATS_KINDS: ReadonlySet<string> = new Set(["greenhouse", "lever", "ashby"]);
const ATS_NAME = "Sitios de empleos de las empresas";
const OTHER_SOURCES = "Otras fuentes";

function sourceName(kind: string): string {
  if (ATS_KINDS.has(kind)) return ATS_NAME;
  if (!Object.hasOwn(SOURCE_ATTRIBUTION, kind)) return OTHER_SOURCES;
  return SOURCE_ATTRIBUTION[kind as keyof typeof SOURCE_ATTRIBUTION]?.name ?? OTHER_SOURCES;
}

/** Cálculo puro del mercado de una carrera a partir de los avisos activos de su pool. */
export function buildCareerMarket(input: CareerMarketInput): CareerMarket {
  const { jobs } = input;
  const total = jobs.length;
  const nowMs = Date.parse(input.now);

  // Skills
  const skillsByJob = new Map<string, { slug: string; isMust: boolean }[]>();
  const names = new Map<string, string>();
  for (const s of input.skills) {
    if (!names.has(s.slug)) names.set(s.slug, s.name);
    const list = skillsByJob.get(s.jobId) ?? [];
    list.push({ slug: s.slug, isMust: s.isMust });
    skillsByJob.set(s.jobId, list);
  }
  const skills = roleDemand(jobs.map((j) => ({ skills: skillsByJob.get(j.id) ?? [] })))
    .slice(0, TOP_SKILLS)
    .map((r) => ({
      slug: r.slug,
      name: names.get(r.slug) ?? r.slug,
      jobs: r.mentions,
      must: r.mustMentions,
      nice: r.mentions - r.mustMentions,
      share: total ? r.mentions / total : 0,
    }));

  const seniority: Record<SeniorityBucket, number> = {
    junior: 0,
    semi: 0,
    senior: 0,
    lead: 0,
    unknown: 0,
  };
  const levels: Record<EnglishLevel | "sin_nivel", number> = {
    basico: 0,
    intermedio: 0,
    avanzado: 0,
    fluido: 0,
    sin_nivel: 0,
  };
  let asks = 0;
  let writtenInEnglish = 0;
  const modality = { remoto: 0, hibrido: 0, presencial: 0, desconocida: 0 };
  const fromArgentina = { acepta: 0, no_acepta: 0, no_dice: 0 };
  const sources = new Map<string, number>();
  const salaryPoints: (number | null)[] = [];
  let new24h = 0;

  for (const job of jobs) {
    seniority[seniorityBucket(job.seniority, job.title)]++;

    const en = detectEnglish(job.jdText, job.lang);
    if (en.language === "en") writtenInEnglish++;
    if (en.asks) {
      asks++;
      levels[en.level ?? "sin_nivel"]++;
    }

    salaryPoints.push(monthlySalaryPoint(job.salaryMinUsd, job.salaryMaxUsd, job.salaryPeriod));

    const m = job.modality;
    modality[m === "remoto" || m === "hibrido" || m === "presencial" ? m : "desconocida"]++;

    const scope = locationScope(job.locationRaw, job.countriesAllowed);
    if (scope.kind === "unknown") fromArgentina.no_dice++;
    else if (scope.kind === "any" || allowsCountry(scope, "AR")) fromArgentina.acepta++;
    else fromArgentina.no_acepta++;

    const name = sourceName(job.sourceKind);
    sources.set(name, (sources.get(name) ?? 0) + 1);

    if (Date.parse(job.publishedAt) >= nowMs - DAY_MS) new24h++;
  }

  return {
    role: input.role,
    total,
    smallSample: total < SMALL_SAMPLE_JOBS,
    computedAt: input.now,
    poolUpdatedAt: input.poolUpdatedAt,
    skills,
    seniority: { counts: seniority },
    english: { asks, levels, writtenInEnglish, estimated: ENGLISH_ESTIMATED },
    salary: summarizeSalaries(salaryPoints, total),
    volume: {
      active: total,
      new24h,
      modality,
      fromArgentina,
      sources: [...sources]
        .map(([name, count]) => ({ name, jobs: count }))
        .sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name)),
    },
  };
}
