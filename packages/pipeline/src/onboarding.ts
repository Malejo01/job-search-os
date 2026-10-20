import { z } from "zod";
import { isIsoCountry } from "./countries";
import type { CriteriaRules } from "./criteria";
import { DISCIPLINES } from "./evaluation";
import { type RoleKey } from "./skills/self-assessment";
import { parseTargetRoles, TARGET_ROLES_DEFAULT_LIMIT } from "./skills/target-roles";

/**
 * Onboarding obligatorio (B2, JS-094): qué es un "perfil completo" y cómo se valida el formulario.
 * Puro: la app lee el perfil y los criterios y pasa los datos; acá solo se decide.
 */

export { ISO_COUNTRY_CODES, isIsoCountry } from "./countries";

export const MIN_SUMMARY_CHARS = 80;
export const MAX_SUMMARY_CHARS = 2000;

/** Países de LATAM: el buscador de país de residencia los muestra primero. */
export const COUNTRY_OPTIONS = [
  { code: "AR", label: "Argentina" },
  { code: "BO", label: "Bolivia" },
  { code: "BR", label: "Brasil" },
  { code: "CL", label: "Chile" },
  { code: "CO", label: "Colombia" },
  { code: "CR", label: "Costa Rica" },
  { code: "CU", label: "Cuba" },
  { code: "DO", label: "República Dominicana" },
  { code: "EC", label: "Ecuador" },
  { code: "SV", label: "El Salvador" },
  { code: "GT", label: "Guatemala" },
  { code: "HN", label: "Honduras" },
  { code: "MX", label: "México" },
  { code: "NI", label: "Nicaragua" },
  { code: "PA", label: "Panamá" },
  { code: "PY", label: "Paraguay" },
  { code: "PE", label: "Perú" },
  { code: "PR", label: "Puerto Rico" },
  { code: "UY", label: "Uruguay" },
  { code: "VE", label: "Venezuela" },
] as const;

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** `XX` es el marcador que deja el registro por invitación: no cuenta como país. */
export function isValidCountry(code: string | null | undefined): boolean {
  return typeof code === "string" && /^[A-Z]{2}$/.test(code) && code !== "XX";
}

export type ProfileCompletenessInput = {
  locationCountry: string | null | undefined;
  profileSummary: string | null | undefined;
  activeCriteriaCount: number;
};

/** País válido (ISO-2, no `XX`), resumen de al menos MIN_SUMMARY_CHARS y un criterio activo. */
export function isProfileComplete(p: ProfileCompletenessInput): boolean {
  return (
    isValidCountry(p.locationCountry) &&
    (p.profileSummary ?? "").trim().length >= MIN_SUMMARY_CHARS &&
    p.activeCriteriaCount >= 1
  );
}

/**
 * Reglas por defecto de un usuario nuevo: neutras (todas las disciplinas, sin piso salarial, sin
 * penalización por inglés, solo cargos de dirección excluidos). Ya no son espejo de
 * packages/db/seeds/criteria.example.json, que queda como fixture de un perfil de desarrollo;
 * un test compara solo lo que no cambió. No se lee el archivo para no depender de I/O.
 */
export const DEFAULT_CRITERIA_RULES: CriteriaRules = {
  // "vp " lleva el espacio final a propósito: no coincide con "vpn" ni "mvp".
  title_blocklist: ["director", "vp ", "chief", "head of"],
  title_allowlist: ["agent architect"],
  title_cap_score: 3,
  title_cap_score_if_few_candidates: { max_candidates: 5, cap: 5, disciplines: ["ai_engineer"] },
  max_years_hard: 8,
  years_penalty: { from: 5, to: 7, penalty: 2 },
  years_gap: { risk_from: 1, penalty_from: null, penalty: 0.5, blocker_from: null },
  ml_engineer_keywords: [
    "fine-tuning",
    "fine tuning",
    "lora",
    "qlora",
    "peft",
    "pytorch",
    "tensorflow",
    "sagemaker",
    "rlhf",
    "dpo",
    "distributed training",
    "entrenamiento distribuido",
  ],
  ai_eval_keywords: [
    "eval harness",
    "llm-as-judge",
    "red-teaming",
    "red teaming",
    "golden dataset",
    "evaluación de sistemas de ia",
  ],
  other_discipline_keywords: [
    "iam",
    "sailpoint",
    "saviynt",
    "identity governance",
    "seo",
    "growth",
    "pmp",
    "prince2",
    "teams admin",
    "exchange online",
    "medios de pago",
    "iso 8583",
    "ciberseguridad",
    "cybersecurity",
    "project manager",
    "scrum master",
    "business owner",
  ],
  allowed_disciplines: [...DISCIPLINES],
  discipline_cap_score: 4,
  english_risk_from: "avanzado",
  cloud_must_penalty: 1,
  english_fluent_penalty: 0,
  easy_apply_penalty: 0,
  skills_match_badge: { analyze_from: 0.6, discard_below: 0.4 },
  salary_floor_usd_monthly: null,
  max_weekly_hours: 40,
  thresholds: { personalizado: 9, aplicar: 7, guardar: 5 },
};

/** Reglas por defecto con el piso salarial y las horas del formulario, si los cargó. */
export function criteriaFromOnboarding(input: {
  salaryFloorUsd: number | null;
  maxWeeklyHours: number | null;
}): CriteriaRules {
  return {
    ...DEFAULT_CRITERIA_RULES,
    salary_floor_usd_monthly: input.salaryFloorUsd ?? null,
    max_weekly_hours: input.maxWeeklyHours ?? DEFAULT_CRITERIA_RULES.max_weekly_hours,
  };
}

/** Modalidades de trabajo que la persona puede aceptar (subconjunto de `jobs.modality`). */
export const MODALITIES = ["remoto", "hibrido", "presencial"] as const;
export type AcceptedModality = (typeof MODALITIES)[number];
export type JobLanguage = "es" | "en";

/** Solo remoto: es lo que mantiene `profiles.remote_only` en sincronía con `accepted_modalities`. */
export function isRemoteOnly(modalities: readonly string[]): boolean {
  return modalities.length === 1 && modalities[0] === "remoto";
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const optionalInt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int().min(min).max(max).nullable());

export const onboardingSchema = z
  .object({
    // Ya validados por parseTargetRoles (parseOnboarding los pasa por ahí antes del schema).
    targetRoles: z.array(z.custom<RoleKey>()),
    country: z.string().trim().toUpperCase(),
    city: optionalText(100),
    // Casillas Remoto/Híbrido/Presencial: al menos una, sin repetidos ni valores ajenos.
    acceptedModalities: z.array(z.enum(MODALITIES)).min(1),
    // Radio: "es", "en" o "both" (los dos).
    jobLanguage: z.enum(["es", "en", "both"]),
    workAuthUs: z.boolean(),
    workAuthEu: z.boolean(),
    workAuthOther: z.array(z.string().trim().toUpperCase()),
    englishCefr: z.enum(CEFR_LEVELS),
    yearsTotal: z
      .string()
      .trim()
      .transform((v) => (v === "" ? NaN : Number(v)))
      .pipe(z.number().min(0).max(60)),
    salaryFloorUsd: optionalInt(0, 100000),
    maxWeeklyHours: optionalInt(1, 80),
    summary: z.string().trim().min(MIN_SUMMARY_CHARS).max(MAX_SUMMARY_CHARS),
  })
  .superRefine((v, ctx) => {
    // Cualquier ISO-2 asignado (el buscador del form ofrece todos); `XX` y lo inventado, no
    if (!isIsoCountry(v.country)) {
      ctx.addIssue({ code: "custom", path: ["country"], message: "país inválido" });
    }
    if (v.workAuthOther.some((c) => !isIsoCountry(c))) {
      ctx.addIssue({ code: "custom", path: ["workAuthOther"], message: "país inválido" });
    }
  });

export type OnboardingInput = {
  /** Puestos que busca (1 a `limit`); el primero es el principal (`target_role`). */
  targetRoles: RoleKey[];
  locationCountry: string;
  locationCity: string | null;
  /** Modalidades aceptadas, en el orden de `MODALITIES`, sin repetir (al menos una). */
  acceptedModalities: AcceptedModality[];
  /** Derivado de `acceptedModalities`: true si solo acepta remoto. */
  remoteOnly: boolean;
  /** Idiomas de las ofertas que acepta (uno o los dos). */
  jobLanguages: JobLanguage[];
  workAuth: { us: boolean; eu: boolean; other?: string[] };
  englishCefr: (typeof CEFR_LEVELS)[number];
  yearsTotal: number;
  salaryFloorUsd: number | null;
  maxWeeklyHours: number | null;
  profileSummary: string;
};

export type OnboardingParse =
  | { ok: true; value: OnboardingInput }
  /** `reason` solo viene en `summary`: por debajo del mínimo o por encima del máximo. */
  | { ok: false; field: string; reason?: "min" | "max" };

/**
 * Valida los campos crudos del formulario (strings; las casillas llegan como "on"/ausente).
 * `targetRoles` llega como lista (el form manda un `targetRoles` por casilla) y se valida con
 * `parseTargetRoles` contra `limit`, el tope ya resuelto por `targetRolesLimit` (por defecto, el
 * del plan gratis). Si falla devuelve el primer campo con error, sin eco del valor.
 */
export function parseOnboarding(
  raw: Record<string, string | readonly string[] | undefined>,
  limit: number = TARGET_ROLES_DEFAULT_LIMIT,
): OnboardingParse {
  const s = (k: string) => {
    const v = raw[k];
    return typeof v === "string" ? v : "";
  };
  const list = (k: string): string[] => {
    const v = raw[k];
    return typeof v === "string" ? [v] : [...(v ?? [])];
  };
  const rolesRaw = raw.targetRoles;
  const roles = parseTargetRoles(
    typeof rolesRaw === "string" ? [rolesRaw] : [...(rolesRaw ?? [])],
    limit,
  );
  if (!roles.ok) return { ok: false, field: roles.field };
  const parsed = onboardingSchema.safeParse({
    targetRoles: roles.roles,
    country: s("country"),
    city: s("city"),
    // Sin casilla marcada o con un valor ajeno falla en vez de asumir algo.
    acceptedModalities: list("acceptedModalities"),
    // Radio sin valor marcado: ausente u otro valor falla.
    jobLanguage: s("jobLanguage"),
    workAuthUs: s("workAuthUs") === "on",
    workAuthEu: s("workAuthEu") === "on",
    // Lista (un valor por país) o, por compatibilidad, un solo texto "CA, MX".
    workAuthOther: list("workAuthOther")
      .flatMap((x) => x.split(","))
      .map((x) => x.trim())
      .filter(Boolean),
    englishCefr: s("englishCefr"),
    yearsTotal: s("yearsTotal"),
    salaryFloorUsd: s("salaryFloorUsd"),
    maxWeeklyHours: s("maxWeeklyHours"),
    // El navegador cuenta el salto de línea como 1 y lo envía como \r\n: se normaliza para que el
    // largo sea el que ve el contador
    summary: s("summary").replace(/\r\n?/g, "\n"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? "form");
    if (field === "summary") {
      if (issue?.code === "too_small") return { ok: false, field, reason: "min" };
      if (issue?.code === "too_big") return { ok: false, field, reason: "max" };
    }
    return { ok: false, field };
  }
  const v = parsed.data;
  const other = [...new Set(v.workAuthOther)].slice(0, 10);
  const acceptedModalities = MODALITIES.filter((m) => v.acceptedModalities.includes(m));
  return {
    ok: true,
    value: {
      targetRoles: v.targetRoles,
      locationCountry: v.country,
      locationCity: v.city,
      acceptedModalities,
      remoteOnly: isRemoteOnly(acceptedModalities),
      jobLanguages: v.jobLanguage === "both" ? ["es", "en"] : [v.jobLanguage],
      workAuth: { us: v.workAuthUs, eu: v.workAuthEu, ...(other.length ? { other } : {}) },
      englishCefr: v.englishCefr,
      yearsTotal: v.yearsTotal,
      salaryFloorUsd: v.salaryFloorUsd,
      maxWeeklyHours: v.maxWeeklyHours,
      profileSummary: v.summary,
    },
  };
}
