import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEvaluateJobVars,
  prefilter,
  type CriteriaRules,
  type JobForPrompt,
  type PrefilterResult,
  type ProfileForPrompt,
} from "@job-search-os/pipeline";
import { loadFixture } from "@job-search-os/db";
import roleSkills from "../../packages/db/seeds/role_skills.json";

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
    /** Opcionales: el perfil de referencia no los trae y el prompt recibe "no especificado". */
    target_role?: string | null;
    target_roles?: string[] | null;
  };
};
type AdversarialFile = { meta: { version: string; descripcion: string }; jobs: GoldenJob[] };
const goldenFx = loadFixture<GoldenFile>("golden");
const golden = goldenFx.data;
// Siempre público: los avisos manipulados son inventados y se miden junto a cualquier golden
const adversarial = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/adversarial.json"),
    "utf8",
  ),
) as AdversarialFile;
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
  /**
   * JD recortada del aviso (misión + responsabilidades + requisitos), solo en los casos donde el
   * resumen de campos no alcanza para reproducir el error: la disciplina por requisitos y el nivel
   * de inglés se leen del texto, no de un campo ya masticado. Con `jd`, had_full_jd = true.
   */
  jd?: string | null;
  human_score: number | null;
  /** Score de match puro (definición v1.1). Ancla para prompts >= v1.1. */
  human_score_match: number | null;
  /** Bloqueadores y riesgos con la definición v1.1. */
  human_blockers: string[];
  human_risks: string[];
  /** Ubicación pura (definición v1.1): ok | riesgo | no. Ancla para prompts >= v1.1. */
  human_location_ok: string;
  /** "human" (a mano) o "assisted" (rúbrica fija revisada por Mauro, JS-052). Ausente = human. */
  anchor_source?: "human" | "assisted";
  score_nota?: string;
  /** Aviso manipulado inventado (ronda 43): se mide con injection_resistance y queda fuera de D-019. */
  adversarial?: boolean;
  accion: string;
  estado: string;
  location_ok: string;
};

export const goldenMeta = golden.meta;
/** Golden sin los adversariales: la base de las 4 métricas de D-019. */
export const baseGoldenJobs = golden.jobs.slice().sort((a, b) => a.id - b.id);
export const adversarialJobs = adversarial.jobs
  .map((j) => ({ ...j, adversarial: true }))
  .sort((a, b) => a.id - b.id);
/** Lo que corre el harness: golden (privado o público) + adversariales, siempre. */
export const goldenJobs = [...baseGoldenJobs, ...adversarialJobs];
export const criteriaRules = criteriaSeed as unknown as CriteriaRules;

const stableStringify = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
};

/**
 * Hash corto de los criterios con los que se corrió (o recalculó) un reporte. Con claves
 * ordenadas: el orden de las propiedades no lo cambia. Sirve para avisar cuando `recompute`
 * usa criterios distintos de los de la corrida (JS-067).
 */
export function hashCriteria(rules: unknown): string {
  return createHash("sha256").update(stableStringify(rules)).digest("hex").slice(0, 12);
}

export const criteriaHash = hashCriteria(criteriaRules);

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
    // Igual que producción (ingesta / evaluate-job): lee profiles.remote_only. Sin userCountry a
    // propósito: "sin parámetro = AR" es la semántica documentada del prefiltro para no mover evals.
    { remoteOnly: profileSeed.profile.remote_only },
  );
}

const p = profileSeed.profile;
const roleLabels = roleSkills as Record<string, { label: string }>;
const seedRole = p.target_roles?.[0] ?? p.target_role ?? null;
/** Label del puesto principal del perfil (role_skills.json); null = el pipeline pone "no especificado". */
export const targetRoleLabel: string | null = seedRole
  ? (roleLabels[seedRole]?.label ?? seedRole)
  : null;
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
  ...(targetRoleLabel ? { targetRoleLabel } : {}),
};

/**
 * Convierte una oferta del golden en la entrada del prompt. Solo entran datos del aviso
 * (título, empresa, ubicacion_raw, contrato, salario, años, nivel, inglés, stack, candidatos,
 * badges). NUNCA entran paises, location_ok, match, gaps, bloqueadores, señales ni notas:
 * son la referencia humana que el modelo tiene que reproducir, no leer.
 */
export function goldenToJob(j: GoldenJob): JobForPrompt {
  const resumen = [
    j.nivel ? `Nivel: ${j.nivel}` : null,
    j.anos !== null ? `Años de experiencia requeridos: ${j.anos}` : null,
    j.ingles !== "no_menciona" ? `Inglés: ${j.ingles}` : null,
    j.stack.length ? `Stack y requisitos (resumen del aviso): ${j.stack.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  // Con jd, el modelo lee el aviso de verdad (ids 35 y 36); si no, el resumen de campos.
  const jd = j.jd?.trim() ? j.jd.trim() : resumen;
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

/**
 * Variables del prompt para una oferta del golden. had_full_jd=false salvo que la oferta traiga
 * `jd`: en ese caso el modelo está leyendo el aviso de verdad y puede inferir must del texto.
 * `promptRef` decide si el aviso va delimitado (v1.4+); sin él, el texto de v1.3.4 de siempre.
 */
export function goldenVars(
  j: GoldenJob,
  promptRef: string = "evaluate_job@v1.3.4",
): Record<string, string | boolean> {
  const vars = buildEvaluateJobVars({
    profile,
    rules: criteriaRules,
    job: goldenToJob(j),
    promptRef,
  });
  vars.had_full_jd = Boolean(j.jd?.trim());
  return vars;
}
