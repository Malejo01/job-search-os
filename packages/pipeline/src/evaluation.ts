import { z } from "zod";

/**
 * Contrato de salida del evaluador (docs/EVALUATOR_PROMPT_v1.md §4).
 * El LLM propone; `decide()` (JS-011) recalcula `accion` en código.
 */
export const DISCIPLINES = [
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
  disciplina: z.enum(DISCIPLINES),
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
  years_discipline: z.enum(DISCIPLINES).nullable(),
});

/** gaps de v1 (string) → {skill, nivel: "must"}; los tipados pasan tal cual. */
const GapTolerantSchema = z.union([
  z.string().transform((skill): Gap => ({ skill, nivel: "must" })),
  GapSchema,
]);

export const EvaluationSchema = EvaluationV1OutputSchema.omit({ gaps: true }).extend({
  gaps: z.array(GapTolerantSchema),
  riesgos: z.array(z.string()).default([]),
  /** v1.3.2+; en versiones anteriores queda null y las reglas de dominio no corren. */
  years_domain: z.string().nullable().default(null),
  years_discipline: z.enum(DISCIPLINES).nullable().default(null),
});

export type Evaluation = z.output<typeof EvaluationSchema>;

const toGaps = (gaps: string[]): Gap[] => gaps.map((skill) => ({ skill, nivel: "must" }));

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
      return EvaluationV12OutputSchema;
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
};

const line = (label: string, value: unknown): string | null =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)
    ? null
    : `- ${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`;

const lines = (items: (string | null)[]) => items.filter((l): l is string => l !== null).join("\n");

/** `{{job}}` del prompt: campos estructurados + JD (o "JD NO DISPONIBLE"). */
export function renderJob(job: JobForPrompt): string {
  const salary =
    job.salaryMinUsd || job.salaryMaxUsd
      ? `${job.salaryMinUsd ?? "?"}–${job.salaryMaxUsd ?? "?"} USD ${job.salaryPeriod ?? ""}${
          job.salaryNote ? ` (${job.salaryNote})` : ""
        }`.trim()
      : null;
  const posted =
    job.postedAt instanceof Date ? job.postedAt.toISOString().slice(0, 10) : (job.postedAt ?? null);
  const header = lines([
    line("Título", job.title),
    line("Empresa", job.companyRaw),
    line("Ubicación", job.locationRaw),
    line("Países permitidos", job.countriesAllowed),
    line("Modalidad", job.modality),
    line("Contrato", job.contractType),
    line("Salario", salary),
    line("Horas semanales", job.weeklyHours),
    line("Candidatos", job.candidatesCount),
    line("Badges", job.badges),
    line("Publicada", posted),
  ]);
  const jd = job.jdText?.trim() ? job.jdText.trim() : "JD NO DISPONIBLE";
  return `${header}\n\nDescripción del puesto:\n${jd}`;
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
}): Record<string, string | boolean> {
  const hadFullJd = Boolean(input.job.jdText?.trim());
  return {
    profile_summary: input.profile.profileSummary,
    constraints: renderConstraints(input.profile),
    criteria: renderCriteria(input.rules),
    job: renderJob(input.job),
    had_full_jd: hadFullJd,
  };
}
