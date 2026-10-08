import { z } from "zod";
import type { CriteriaRules } from "./criteria";

/**
 * Onboarding obligatorio (B2, JS-094): qué es un "perfil completo" y cómo se valida el formulario.
 * Puro: la app lee el perfil y los criterios y pasa los datos; acá solo se decide.
 */

export const MIN_SUMMARY_CHARS = 80;
export const MAX_SUMMARY_CHARS = 2000;

/** Países de LATAM del selector; "OTRO" habilita el campo de código ISO-2 libre. */
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

export const OTHER_COUNTRY = "OTRO";
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
 * Reglas por defecto de un usuario nuevo. Espejo de packages/db/seeds/criteria.example.json
 * (un test las compara); no se lee el archivo para no depender de fixtures-private ni de I/O.
 */
export const DEFAULT_CRITERIA_RULES: CriteriaRules = {
  title_blocklist: [
    "lead",
    "manager",
    "director",
    "head of",
    "principal",
    "architect",
    "tech lead",
    "vp ",
    "chief",
  ],
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
  allowed_disciplines: ["ai_engineer", "fullstack", "frontend", "backend", "arquitectura"],
  discipline_cap_score: 4,
  english_risk_from: "avanzado",
  cloud_must_penalty: 1,
  english_fluent_penalty: 1,
  easy_apply_penalty: 0,
  skills_match_badge: { analyze_from: 0.6, discard_below: 0.4 },
  salary_floor_usd_monthly: 3000,
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
    salary_floor_usd_monthly:
      input.salaryFloorUsd ?? DEFAULT_CRITERIA_RULES.salary_floor_usd_monthly,
    max_weekly_hours: input.maxWeeklyHours ?? DEFAULT_CRITERIA_RULES.max_weekly_hours,
  };
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
    country: z.string().trim().toUpperCase(),
    countryOther: z.string().trim().toUpperCase(),
    city: optionalText(100),
    remoteOnly: z.boolean(),
    workAuthUs: z.boolean(),
    workAuthEu: z.boolean(),
    workAuthOther: optionalText(200),
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
    const code = v.country === OTHER_COUNTRY ? v.countryOther : v.country;
    if (!isValidCountry(code)) {
      ctx.addIssue({
        code: "custom",
        path: [v.country === OTHER_COUNTRY ? "countryOther" : "country"],
        message: "país inválido",
      });
    }
  });

export type OnboardingInput = {
  locationCountry: string;
  locationCity: string | null;
  remoteOnly: boolean;
  workAuth: { us: boolean; eu: boolean; other?: string[] };
  englishCefr: (typeof CEFR_LEVELS)[number];
  yearsTotal: number;
  salaryFloorUsd: number | null;
  maxWeeklyHours: number | null;
  profileSummary: string;
};

export type OnboardingParse = { ok: true; value: OnboardingInput } | { ok: false; field: string };

/**
 * Valida los campos crudos del formulario (strings; las casillas llegan como "on"/ausente).
 * Si falla devuelve el primer campo con error, sin eco del valor.
 */
export function parseOnboarding(raw: Record<string, string | undefined>): OnboardingParse {
  const s = (k: string) => raw[k] ?? "";
  const parsed = onboardingSchema.safeParse({
    country: s("country"),
    countryOther: s("countryOther"),
    city: s("city"),
    remoteOnly: s("remoteOnly") === "on",
    workAuthUs: s("workAuthUs") === "on",
    workAuthEu: s("workAuthEu") === "on",
    workAuthOther: s("workAuthOther"),
    englishCefr: s("englishCefr"),
    yearsTotal: s("yearsTotal"),
    salaryFloorUsd: s("salaryFloorUsd"),
    maxWeeklyHours: s("maxWeeklyHours"),
    summary: s("summary"),
  });
  if (!parsed.success) {
    return { ok: false, field: String(parsed.error.issues[0]?.path[0] ?? "form") };
  }
  const v = parsed.data;
  const other = (v.workAuthOther ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((x) => x.slice(0, 40));
  return {
    ok: true,
    value: {
      locationCountry: v.country === OTHER_COUNTRY ? v.countryOther : v.country,
      locationCity: v.city,
      remoteOnly: v.remoteOnly,
      workAuth: { us: v.workAuthUs, eu: v.workAuthEu, ...(other.length ? { other } : {}) },
      englishCefr: v.englishCefr,
      yearsTotal: v.yearsTotal,
      salaryFloorUsd: v.salaryFloorUsd,
      maxWeeklyHours: v.maxWeeklyHours,
      profileSummary: v.summary,
    },
  };
}
