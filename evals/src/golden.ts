import {
  buildEvaluateJobVars,
  prefilter,
  type CriteriaRules,
  type JobForPrompt,
  type PrefilterResult,
  type ProfileForPrompt,
} from "@job-search-os/pipeline";
import { loadFixture } from "@job-search-os/db";

/**
 * Golden, perfil y criterios: privados (fixtures-private/) si existen, de ejemplo si no. Los
 * evals miden contra el criterio del usuario real cuando está; en CI y en un clon del repo,
 * contra el dataset de ejemplo anonimizado (mismos casos de frontera, empresas Empresa A…AB).
 */
type GoldenFile = {
  meta: { version: string; descripcion: string; perfil_referencia: string; notas_campos: string };
  jobs: GoldenJob[];
  dedup_pairs: unknown[];
  prefilter_expectations: unknown;
};
type ProfileFile = {
  profile: {
    profile_summary: string;
    location_country: string;
    location_city: string;
    remote_only: boolean;
    work_auth: { us: boolean; eu: boolean; other?: string[] };
    salary_floor_usd: number;
    max_weekly_hours: number;
    english_cefr: string;
    years_total: number;
  };
};
const goldenFx = loadFixture<GoldenFile>("golden");
const golden = goldenFx.data;
const profileSeed = loadFixture<ProfileFile>("profile").data;
const criteriaSeed = loadFixture<CriteriaRules>("criteria").data;
export const goldenSource = goldenFx.source;

export type GoldenJob = {
  id: number;
  empresa: string;
  titulo: string;
  fuente: string;
  fecha: string;
  ubicacion: string | null;
  /** Texto de ubicación tal como figuraba en el aviso: lo único sobre ubicación que ve el modelo. */
  ubicacion_raw: string;
  /** Interpretación humana (referencia). NUNCA entra al prompt. */
  paises: string[] | null;
  modalidad: string;
  contrato: string | null;
  salario: { min: number; max: number; periodo: string; nota?: string } | null;
  anos: number | null;
  nivel: string | null;
  disciplina: string;
  ingles: string;
  tipo_empresa: string;
  stack: string[];
  match: string[];
  gaps: string[];
  bloqueadores: string[];
  senales: string[];
  candidatos: number | null;
  badges: string[];
  human_score: number | null;
  /** Score de match puro (definición v1.1). Ancla para prompts >= v1.1. */
  human_score_match: number | null;
  /** Bloqueadores y riesgos con la definición v1.1. */
  human_blockers: string[];
  human_risks: string[];
  /** Ubicación pura (definición v1.1): ok | riesgo | no. Ancla para prompts >= v1.1. */
  human_location_ok: string;
  score_nota?: string;
  accion: string;
  estado: string;
  location_ok: string;
};

export const goldenMeta = golden.meta;
export const goldenJobs = golden.jobs.slice().sort((a, b) => a.id - b.id);
export const criteriaRules = criteriaSeed as unknown as CriteriaRules;

/**
 * Lo que el prefiltro de producción decidiría con los campos de un email (título, empresa,
 * ubicación, modalidad, badges, candidatos). Sin países estructurados: `paises` es anotación
 * humana y el aviso de LinkedIn no los trae. Cap y flags alimentan decide() en el harness.
 */
export function goldenPrefilter(j: GoldenJob): PrefilterResult {
  return prefilter(
    {
      title: j.titulo,
      companyRaw: j.empresa,
      locationRaw: j.ubicacion_raw,
      modality: j.modalidad as "remoto" | "hibrido" | "presencial" | "desconocida",
      badges: j.badges,
      candidatesCount: j.candidatos,
      countriesAllowed: null,
    },
    criteriaRules,
  );
}

const p = profileSeed.profile;
export const profile: ProfileForPrompt = {
  profileSummary: p.profile_summary,
  locationCountry: p.location_country,
  locationCity: p.location_city,
  remoteOnly: p.remote_only,
  workAuth: p.work_auth,
  salaryFloorUsd: p.salary_floor_usd,
  maxWeeklyHours: p.max_weekly_hours,
  englishCefr: p.english_cefr,
  yearsTotal: p.years_total,
};

/**
 * Convierte una oferta del golden en la entrada del prompt. Solo entran datos del aviso
 * (título, empresa, ubicacion_raw, contrato, salario, años, nivel, inglés, stack, candidatos,
 * badges). NUNCA entran paises, location_ok, match, gaps, bloqueadores, señales ni notas:
 * son la referencia humana que el modelo tiene que reproducir, no leer.
 */
export function goldenToJob(j: GoldenJob): JobForPrompt {
  const jd = [
    j.nivel ? `Nivel: ${j.nivel}` : null,
    j.anos !== null ? `Años de experiencia requeridos: ${j.anos}` : null,
    j.ingles !== "no_menciona" ? `Inglés: ${j.ingles}` : null,
    j.stack.length ? `Stack y requisitos (resumen del aviso): ${j.stack.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    title: j.titulo,
    companyRaw: j.empresa,
    locationRaw: j.ubicacion_raw,
    countriesAllowed: null,
    modality: j.modalidad,
    contractType: j.contrato,
    salaryMinUsd: j.salario?.min ?? null,
    salaryMaxUsd: j.salario?.max ?? null,
    salaryPeriod: j.salario?.periodo ?? null,
    salaryNote: j.salario?.nota ?? null,
    candidatesCount: j.candidatos,
    badges: j.badges,
    postedAt: j.fecha,
    jdText: jd || null,
  };
}

/** Variables del prompt para una oferta del golden. had_full_jd=false: es un resumen, no la JD. */
export function goldenVars(j: GoldenJob): Record<string, string | boolean> {
  const vars = buildEvaluateJobVars({ profile, rules: criteriaRules, job: goldenToJob(j) });
  vars.had_full_jd = false;
  return vars;
}
