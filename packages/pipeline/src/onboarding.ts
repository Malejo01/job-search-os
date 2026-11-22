import { REGION_COUNTRIES } from "./countries";
import type { CriteriaRules } from "./criteria";
import { DISCIPLINES } from "./evaluation";
import { type RoleKey } from "./skills/self-assessment";

/**
 * Onboarding obligatorio (B2, JS-094): qué es un "perfil completo", sus constantes y reglas por defecto.
 * Puro: la app lee el perfil y los criterios y pasa los datos; acá solo se decide.
 * Lo importa también el código de cliente: NO importar acá el detector de instrucciones ni zod. La validación
 * del formulario (`parseOnboarding`, que sí los usa) está en `onboarding-parse.ts`, solo para el servidor.
 */

export { ISO_COUNTRY_CODES, isIsoCountry } from "./countries";

export const MIN_SUMMARY_CHARS = 80;
export const MAX_SUMMARY_CHARS = 2000;

/** Países de LATAM: el buscador de país de residencia los muestra primero (tabla única, JS-111). */
export const COUNTRY_OPTIONS: readonly { code: string; label: string }[] = REGION_COUNTRIES.map(
  ({ code, label }) => ({ code, label }),
);

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

/**
 * Disciplinas permitidas de cada carrera que NO es de tecnología (R6-2). El evaluador vigente
 * (prompt v1.3) solo escribe las disciplinas de `DISCIPLINES_V13`: un aviso de abogacía llega como
 * `otra` o `negocio`, por eso las dos están siempre. La disciplina propia de la carrera va igual,
 * para cuando el prompt las emita. Fuera de la lista = bloqueador de disciplina (`decide`).
 * Las carreras que no están acá (programación, producto, ventas...) no cambian: todas las disciplinas.
 */
export const CAREER_DISCIPLINES: Partial<Record<RoleKey, readonly string[]>> = {
  abogacia: ["abogacia", "negocio", "otra"],
  // `data`: un analista financiero con Excel y SQL puede llegar etiquetado como datos
  finanzas_contabilidad: ["finanzas_contabilidad", "negocio", "data", "otra"],
  // Carrera amplia: coordinar proyectos y procesos, RR.HH., atención o éxito de cliente y análisis
  // con Excel y SQL (`data`) son puestos de entrada típicos
  administracion_empresas: [
    "negocio",
    "project_management",
    "recursos_humanos",
    "customer_success",
    "data",
    "otra",
  ],
  comunicacion: ["comunicacion", "marketing_digital", "creative_production", "negocio", "otra"],
  marketing_digital: ["marketing_digital", "creative_production", "negocio", "otra"],
  relaciones_publicas: [
    "relaciones_publicas",
    "comunicacion",
    "marketing_digital",
    "creative_production",
    "negocio",
    "otra",
  ],
  relaciones_internacionales: [
    "relaciones_internacionales",
    "negocio",
    "project_management",
    "otra",
  ],
};

/**
 * Disciplinas permitidas para los puestos elegidos: la unión de las de cada carrera, en el orden de
 * `DISCIPLINES`. `null` (= no acotar, todas) si no hay puestos o si alguno no tiene lista propia:
 * ante la duda no se descarta a nadie por disciplina.
 */
export function disciplinesForRoles(roles: readonly RoleKey[] | null | undefined): string[] | null {
  if (!roles || roles.length === 0) return null;
  const union = new Set<string>();
  for (const role of roles) {
    const list = CAREER_DISCIPLINES[role];
    if (!list) return null;
    for (const d of list) union.add(d);
  }
  return DISCIPLINES.filter((d) => union.has(d));
}

/**
 * Reglas por defecto con el piso salarial y las horas del formulario, si los cargó. Con los puestos
 * elegidos (`targetRoles`) las disciplinas permitidas salen de la carrera (R6-2); sin ellos, o con
 * una carrera de tecnología, son todas como siempre.
 */
export function criteriaFromOnboarding(input: {
  salaryFloorUsd: number | null;
  maxWeeklyHours: number | null;
  targetRoles?: readonly RoleKey[] | null;
}): CriteriaRules {
  const disciplines = disciplinesForRoles(input.targetRoles);
  return {
    ...DEFAULT_CRITERIA_RULES,
    // Copia: quien muta sus reglas no toca la constante compartida
    allowed_disciplines: disciplines ?? [...DEFAULT_CRITERIA_RULES.allowed_disciplines],
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

/**
 * Modalidades efectivas de un perfil (ronda 84). Valores ajenos se descartan; vacío = solo remoto.
 * `remote_only = false` con solo remoto en la lista es un perfil sin sincronizar (anterior al
 * backfill de la ronda 78): vale lo que decía `remote_only`, que acepta las tres.
 */
export function effectiveAcceptedModalities(p: {
  remoteOnly?: boolean | null;
  acceptedModalities?: readonly string[] | null;
}): AcceptedModality[] {
  const list = MODALITIES.filter((m) => p.acceptedModalities?.includes(m));
  if (p.remoteOnly === false && !list.some((m) => m !== "remoto")) return [...MODALITIES];
  return list.length ? list : ["remoto"];
}
