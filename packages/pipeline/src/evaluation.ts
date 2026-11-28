import { z } from "zod";
import { renderJobCardForPrompt } from "./evaluator/ficha-prompt";
import { err, ok, type Result } from "./result";

/**
 * Contrato de salida del evaluador (docs/EVALUATOR_PROMPT_v1.md §4).
 * El LLM propone; `decide()` (JS-011) recalcula `accion` en código.
 */
export const DISCIPLINES_V13 = [
  "ai_engineer",
  "ml_engineer",
  "ai_evaluation",
  /** La IA es herramienta de otro oficio: publicidad, diseño, video, marketing creativo (JS-052). */
  "creative_production",
  "fullstack",
  "frontend",
  "backend",
  "devops",
  "data",
  "ciberseguridad",
  "negocio",
  "project_management",
  "administracion_plataformas",
  "arquitectura",
  "otra",
] as const;

/**
 * Las 15 de v1 a v1.3.4 más las carreras digitales (ronda 43). El JSON schema que ve el modelo
 * vigente usa DISCIPLINES_V13 y no cambia; v1.4+, la base, los criterios y las etiquetas usan estas.
 */
export const DISCIPLINES = [
  ...DISCIPLINES_V13,
  "marketing_digital",
  "producto",
  "recursos_humanos",
  "customer_success",
  // R6-2: carreras no técnicas de la beta (el JSON schema vigente del modelo no las emite todavía)
  "abogacia",
  "finanzas_contabilidad",
  "comunicacion",
  "relaciones_internacionales",
  "relaciones_publicas",
] as const;

/** Gap tipado (prompt v1.1+): solo los "must" del stack central afectan el score. */
export const GapSchema = z.object({
  skill: z.string(),
  nivel: z.enum(["must", "deseable"]),
});
export type Gap = z.infer<typeof GapSchema>;

/**
 * Salida del prompt v1 tal cual se la pide al modelo. Es lo que viaja como JSON schema al
 * proveedor: no se le agregan campos sin cambiar la versión del prompt.
 */
export const EvaluationV1OutputSchema = z.object({
  score: z.number().min(0).max(10),
  confianza: z.enum(["alta", "media", "baja"]),
  years_required: z.number().int().nullable(),
  location_ok: z.enum(["ok", "riesgo", "no"]),
  modalidad: z.enum(["remoto", "hibrido", "presencial", "desconocida"]),
  disciplina: z.enum(DISCIPLINES_V13),
  ingles_requerido: z.enum(["no_menciona", "no", "basico", "intermedio", "avanzado", "nativo"]),
  tipo_empresa: z.enum(["producto", "startup", "consultora", "staffing", "agencia", "desconocido"]),
  paises_permitidos: z.array(z.string()).nullable(),
  match_fuerte: z.array(z.string()).max(8),
  gaps: z.array(z.string()).max(8),
  bloqueadores_duros: z.array(z.string()),
  senales_positivas: z.array(z.string()),
  veredicto: z.string().max(200),
  accion_sugerida: z.enum(["aplicar_personalizado", "aplicar", "guardar", "descartar"]),
});

/**
 * Evaluación normalizada para código y persistencia: tolera salidas de cualquier versión
 * de prompt. `riesgos` no existe en v1 → [].
 */
export const EvaluationV11OutputSchema = EvaluationV1OutputSchema.omit({ gaps: true }).extend({
  gaps: z.array(GapSchema).max(8),
  /** Riesgos no bloqueantes: país no listado, LATAM sin países, salario no publicado, staffing... */
  riesgos: z.array(z.string()),
});

/**
 * v1.3.2 (JS-052): los años vienen con su dominio. `years_required` solo decía "2" y el evaluador
 * comparaba 2 años de publicidad con 2 años de desarrollo. Ahora el modelo dice de QUÉ son esos
 * años (`years_domain`, texto del aviso) y a qué disciplina pertenecen (`years_discipline`), y el
 * código decide si el candidato puede tenerlos.
 */
export const EvaluationV12OutputSchema = EvaluationV11OutputSchema.extend({
  years_domain: z.string().nullable(),
  years_discipline: z.enum(DISCIPLINES_V13).nullable(),
});

/** v1.4.0: igual que v1.3.x pero con las 19 disciplinas. */
export const EvaluationV14OutputSchema = EvaluationV12OutputSchema.extend({
  disciplina: z.enum(DISCIPLINES),
  years_discipline: z.enum(DISCIPLINES).nullable(),
});

/** gaps de v1 (string) → {skill, nivel: "must"}; los tipados pasan tal cual. */
const GapTolerantSchema = z.union([
  z.string().transform((skill): Gap => ({ skill, nivel: "must" })),
  GapSchema,
]);

export const EvaluationSchema = EvaluationV1OutputSchema.omit({ gaps: true }).extend({
  gaps: z.array(GapTolerantSchema),
  disciplina: z.enum(DISCIPLINES),
  riesgos: z.array(z.string()).default([]),
  /** v1.3.2+; en versiones anteriores queda null y las reglas de dominio no corren. */
  years_domain: z.string().nullable().default(null),
  years_discipline: z.enum(DISCIPLINES).nullable().default(null),
});

export type Evaluation = z.output<typeof EvaluationSchema>;

const toGaps = (gaps: string[]): Gap[] => gaps.map((skill) => ({ skill, nivel: "must" }));

/** Versiones que acepta `outputSchemaFor` (y `evaluationWireFor`); un test exige que ambas coincidan. */
export const EVALUATE_JOB_SCHEMA_VERSIONS = [
  "v1",
  "v1.1",
  "v1.2",
  "v1.3",
  "v1.3.1",
  "v1.3.2",
  "v1.3.3",
  "v1.3.4",
  "v1.4.0",
  "v1.5.0",
] as const;

/** Schema de salida que corresponde a cada versión del prompt evaluate_job. */
export function outputSchemaFor(promptRef: string): z.ZodType<Evaluation, unknown> {
  const version = promptRef.split("@")[1] ?? "v1";
  switch (version) {
    case "v1":
      return EvaluationV1OutputSchema.transform((e) => ({
        ...e,
        gaps: toGaps(e.gaps),
        riesgos: [] as string[],
        years_domain: null,
        years_discipline: null,
      }));
    case "v1.1":
    case "v1.2":
    case "v1.3":
    case "v1.3.1":
      return EvaluationV11OutputSchema.transform((e) => ({
        ...e,
        years_domain: null,
        years_discipline: null,
      }));
    case "v1.3.2":
    case "v1.3.3": // mismo schema; solo cambian ejemplos del prompt (JS-074)
    case "v1.3.4":
      return EvaluationV12OutputSchema;
    case "v1.4.0":
    case "v1.5.0": // R31-06: misma salida que v1.4.0; cambia el prompt (ficha, cualquier carrera). Las dos versiones se leen igual.
      return EvaluationV14OutputSchema;
    default:
      throw new Error(`sin schema de salida para ${promptRef}`);
  }
}

/** Datos de la oferta que entran al prompt (subconjunto de `jobs`, sin I/O). */
export type JobForPrompt = {
  title: string;
  companyRaw: string;
  locationRaw?: string | null;
  countriesAllowed?: string[] | null;
  modality?: string | null;
  contractType?: string | null;
  salaryMinUsd?: number | null;
  salaryMaxUsd?: number | null;
  salaryPeriod?: string | null;
  salaryNote?: string | null;
  weeklyHours?: number | null;
  candidatesCount?: number | null;
  badges?: string[] | null;
  postedAt?: Date | string | null;
  jdText?: string | null;
  /** Puesto del candidato con el que el pool encontró el aviso (jobs.matched_role). */
  matchedRole?: string | null;
};

export type ProfileForPrompt = {
  profileSummary: string;
  locationCountry: string;
  locationCity?: string | null;
  remoteOnly: boolean;
  workAuth: { us: boolean; eu: boolean; other?: string[] };
  salaryFloorUsd?: number | null;
  maxWeeklyHours?: number | null;
  englishCefr?: string | null;
  yearsTotal?: number | null;
  /** Puestos objetivo (profiles.target_roles); el primero es el principal. */
  targetRoles?: readonly string[] | null;
  /** Nombre legible del puesto principal para el prompt (lo resuelve el caller). */
  targetRoleLabel?: string | null;
};

const line = (label: string, value: unknown): string | null =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)
    ? null
    : `- ${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`;

const lines = (items: (string | null)[]) => items.filter((l): l is string => l !== null).join("\n");

/** Marcas del aviso en v1.4+: lo que está entre ellas es texto de terceros, dato y no instrucción. */
export const JOB_OPEN = "<<<AVISO>>>";
export const JOB_CLOSE = "<<<FIN AVISO>>>";

/** v1.4 en adelante recibe el aviso delimitado; v1.3.x y anteriores, el texto de siempre. */
export function promptNeedsDelimitedJob(promptRef: string): boolean {
  const m = /^v(\d+)(?:\.(\d+))?/.exec(promptRef.split("@")[1] ?? promptRef);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  return major > 1 || (major === 1 && minor >= 4);
}

/**
 * v1.5 en adelante recibe también la ficha del aviso (`{{ficha}}`, R31-06). Las versiones anteriores no la
 * piden: no se les suma la variable, así su prompt y su costo no cambian.
 */
export function promptNeedsFicha(promptRef: string): boolean {
  const m = /^v(\d+)(?:\.(\d+))?/.exec(promptRef.split("@")[1] ?? promptRef);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  return major > 1 || (major === 1 && minor >= 5);
}

/** Un "<<<" o ">>>" del texto externo no puede abrir ni cerrar las marcas. */
const escapeMarks = (text: string): string =>
  text.replaceAll("<<<", "‹‹‹").replaceAll(">>>", "›››");

/** Largo máximo de la JD que entra al prompt; lo que sigue se descarta. */
export const JD_PROMPT_MAX_CHARS = 60_000;
/** Largo máximo de título, empresa y ubicación en el prompt (igual que la alta manual). */
export const FIELD_PROMPT_MAX_CHARS = 300;
/** Largo máximo de la nota de sueldo en el prompt. */
export const SALARY_NOTE_PROMPT_MAX_CHARS = 200;
/**
 * Máximo duro: una JD más larga que esto no es un aviso razonable. No se evalúa ni se recorta,
 * la oferta queda pendiente de JD con el motivo. 300.000 caracteres son unos 100.000 tokens.
 */
export const JD_HARD_MAX_CHARS = 300_000;

export type JdSizeCheck =
  | { ok: true; chars: number; estimatedTokens: number; truncated: boolean }
  | { ok: false; chars: number; estimatedTokens: number; reason: string };

/**
 * Mide la JD antes de llamar al modelo. Estimación conservadora: un token cada 3 caracteres.
 * Sin I/O: el caller decide qué hacer con el resultado.
 */
export function checkJdSize(jdText: string | null | undefined): JdSizeCheck {
  const chars = jdText?.length ?? 0;
  const estimatedTokens = Math.ceil(chars / 3);
  if (chars > JD_HARD_MAX_CHARS) {
    return {
      ok: false,
      chars,
      estimatedTokens,
      reason: `JD demasiado larga (${chars} caracteres, máximo ${JD_HARD_MAX_CHARS}): pegá solo la descripción del puesto`,
    };
  }
  return { ok: true, chars, estimatedTokens, truncated: chars > JD_PROMPT_MAX_CHARS };
}

const clip = (value: string | null | undefined, max: number): string | null | undefined =>
  typeof value === "string" && value.length > max ? value.slice(0, max) : value;

/** Topes de los demás campos de texto libre que entran al prompt. */
export const CONTRACT_PROMPT_MAX_CHARS = 100;
export const MODALITY_PROMPT_MAX_CHARS = 50;
export const SALARY_PERIOD_PROMPT_MAX_CHARS = 30;
export const POSTED_AT_PROMPT_MAX_CHARS = 40;
/** Países: un código ISO cada uno y a lo sumo los 250 que existen (el aviso puede traer "*"). */
export const COUNTRY_PROMPT_MAX_CHARS = 40;
export const COUNTRIES_PROMPT_MAX_ITEMS = 250;
/** Etiquetas del aviso (badges). */
export const BADGE_PROMPT_MAX_CHARS = 100;
export const BADGES_PROMPT_MAX_ITEMS = 20;
/** Máximo del prompt completo (suma de las variables de texto): la JD tope más lo que rodea. */
export const PROMPT_MAX_CHARS = 120_000;

/** Lista acotada en cantidad y en largo de cada elemento; los que no son texto se descartan. */
function clipList(
  list: readonly string[] | null | undefined,
  maxItems: number,
  maxChars: number,
): string[] | null | undefined {
  if (!Array.isArray(list)) return list as null | undefined;
  return list
    .slice(0, maxItems)
    .filter((x): x is string => typeof x === "string")
    .map((x) => (x.length > maxChars ? x.slice(0, maxChars) : x));
}

export type PromptSizeError = { chars: number; max: number; reason: string };

/**
 * Mide el prompt completo (suma de las variables de texto) antes de llamar al modelo. No lanza: el
 * llamador decide qué hacer si se pasa. Las variables que no son texto no cuentan.
 */
export function checkPromptSize(
  vars: Record<string, string | boolean>,
  max: number = PROMPT_MAX_CHARS,
): Result<{ chars: number; estimatedTokens: number }, PromptSizeError> {
  let chars = 0;
  for (const v of Object.values(vars)) if (typeof v === "string") chars += v.length;
  if (chars > max) {
    return err({
      chars,
      max,
      reason: `prompt demasiado largo (${chars} caracteres, máximo ${max})`,
    });
  }
  return ok({ chars, estimatedTokens: Math.ceil(chars / 3) });
}

/** `{{job}}` del prompt: campos estructurados + JD (o "JD NO DISPONIBLE"). */
export function renderJob(job: JobForPrompt, opts: { delimit?: boolean } = {}): string {
  const salaryNote = clip(job.salaryNote, SALARY_NOTE_PROMPT_MAX_CHARS);
  const salary =
    job.salaryMinUsd || job.salaryMaxUsd
      ? `${job.salaryMinUsd ?? "?"}–${job.salaryMaxUsd ?? "?"} USD ${clip(job.salaryPeriod, SALARY_PERIOD_PROMPT_MAX_CHARS) ?? ""}${
          salaryNote ? ` (${salaryNote})` : ""
        }`.trim()
      : null;
  const posted =
    job.postedAt instanceof Date
      ? job.postedAt.toISOString().slice(0, 10)
      : (clip(job.postedAt, POSTED_AT_PROMPT_MAX_CHARS) ?? null);
  const header = lines([
    line("Título", clip(job.title, FIELD_PROMPT_MAX_CHARS)),
    line("Empresa", clip(job.companyRaw, FIELD_PROMPT_MAX_CHARS)),
    line("Ubicación", clip(job.locationRaw, FIELD_PROMPT_MAX_CHARS)),
    line(
      "Países permitidos",
      clipList(job.countriesAllowed, COUNTRIES_PROMPT_MAX_ITEMS, COUNTRY_PROMPT_MAX_CHARS),
    ),
    line("Modalidad", clip(job.modality, MODALITY_PROMPT_MAX_CHARS)),
    line("Contrato", clip(job.contractType, CONTRACT_PROMPT_MAX_CHARS)),
    line("Salario", salary),
    line("Horas semanales", job.weeklyHours),
    line("Candidatos", job.candidatesCount),
    line("Badges", clipList(job.badges, BADGES_PROMPT_MAX_ITEMS, BADGE_PROMPT_MAX_CHARS)),
    line("Publicada", posted),
  ]);
  const jd = job.jdText?.trim()
    ? job.jdText.trim().slice(0, JD_PROMPT_MAX_CHARS)
    : "JD NO DISPONIBLE";
  const text = `${header}\n\nDescripción del puesto:\n${jd}`;
  return opts.delimit ? `${JOB_OPEN}\n${escapeMarks(text)}\n${JOB_CLOSE}` : text;
}

/** `{{constraints}}` del prompt desde `profiles`. */
export function renderConstraints(profile: ProfileForPrompt): string {
  const auth = [profile.workAuth.us ? "US" : null, profile.workAuth.eu ? "EU" : null]
    .concat(profile.workAuth.other ?? [])
    .filter(Boolean);
  return lines([
    line(
      "Ubicación",
      `${profile.locationCity ? profile.locationCity + ", " : ""}${profile.locationCountry}`,
    ),
    line("Solo remoto", profile.remoteOnly ? "sí" : "no"),
    line("Autorización de trabajo", auth.length ? auth.join(", ") : "ninguna fuera de su país"),
    line("Piso salarial", profile.salaryFloorUsd ? `USD ${profile.salaryFloorUsd}/mes` : null),
    line("Máximo de horas semanales", profile.maxWeeklyHours),
    line("Inglés (CEFR)", profile.englishCefr),
    line("Años de experiencia", profile.yearsTotal),
  ]);
}

/** `{{criteria}}` del prompt: CriteriaRules renderizadas como texto legible. */
export function renderCriteria(rules: Record<string, unknown>): string {
  return Object.entries(rules)
    .map(([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}

/** Variables completas para `evaluate_job@vN`. */
export function buildEvaluateJobVars(input: {
  profile: ProfileForPrompt;
  rules: Record<string, unknown>;
  job: JobForPrompt;
  promptRef: string;
  /** La ficha ya verificada del aviso (solo la usa v1.5+); sin ella el prompt dice que lea el aviso. */
  jobCard?: Parameters<typeof renderJobCardForPrompt>[0];
}): Record<string, string | boolean> {
  const hadFullJd = Boolean(input.job.jdText?.trim());
  return {
    profile_summary: input.profile.profileSummary,
    constraints: renderConstraints(input.profile),
    criteria: renderCriteria(input.rules),
    job: renderJob(input.job, { delimit: promptNeedsDelimitedJob(input.promptRef) }),
    target_role: input.profile.targetRoleLabel?.trim() || "no especificado",
    had_full_jd: hadFullJd,
    ...(promptNeedsFicha(input.promptRef) ? { ficha: renderJobCardForPrompt(input.jobCard) } : {}),
  };
}
