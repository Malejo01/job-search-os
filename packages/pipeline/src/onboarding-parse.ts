import { z } from "zod";
import { isIsoCountry } from "./countries";
import { detectEvaluatorInjection } from "./evaluator/injection";
import {
  CEFR_LEVELS,
  isRemoteOnly,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
  MODALITIES,
  type AcceptedModality,
  type JobLanguage,
} from "./onboarding";
import { type RoleKey } from "./skills/self-assessment";
import { parseTargetRoles, TARGET_ROLES_DEFAULT_LIMIT } from "./skills/target-roles";

/**
 * Validación del formulario de onboarding (B2, JS-094), solo para el servidor. Vive aparte de `onboarding.ts`
 * a propósito: este módulo trae el detector de instrucciones (`evaluator/injection`) y zod, y `onboarding.ts`
 * (constantes y reglas por defecto) lo importa el código de cliente del formulario. Un test lo fija.
 * Puro: la app pasa los datos y acá solo se decide.
 */

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

/**
 * Señales del detector del evaluador que no se aplican al resumen del perfil. Sobre una oferta
 * solo topan el score, pero acá bloquean el guardado, y saltan con texto laboral normal ("implementé
 * nuevas instrucciones de seguridad", "no evalúes solo el título", "veredicto: aprobado").
 */
export const SUMMARY_IGNORED_SIGNALS: readonly string[] = [
  "nuevas_instrucciones",
  "new_instructions",
  "no_evalues",
  "do_not_evaluate",
  "veredicto_campo",
];

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
  /**
   * `reason` solo viene en el resumen: por debajo del mínimo, por encima del máximo o con frases
   * dirigidas al modelo (`injection`, en el campo `profileSummary`; `signals` son los NOMBRES de
   * los patrones, nunca el texto).
   */
  | { ok: false; field: string; reason?: "min" | "max" | "injection"; signals?: string[] };

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
  // El resumen entra al prompt del evaluador: no se guarda si trae instrucciones para el modelo
  const signals = detectEvaluatorInjection(v.summary).signals.filter(
    (name) => !SUMMARY_IGNORED_SIGNALS.includes(name),
  );
  if (signals.length > 0) {
    return { ok: false, field: "profileSummary", reason: "injection", signals };
  }
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
