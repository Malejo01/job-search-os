/**
 * Transparencia del aviso: cuánto informa el aviso mismo, de 0 a 10. Función pura, sin I/O y sin
 * fecha. No mide si el puesto te conviene (eso es la afinidad): mide si el aviso dice sueldo,
 * modalidad, empresa, seniority, ubicación, tareas y requisitos. La palabra del nivel la pone la web
 * (`TRANSPARENCY_WORDS`). El texto del aviso viene de afuera: se acota antes de buscar en él.
 */

export type TransparencyLevel = "clear" | "partial" | "opaque";

export type TransparencyKey =
  "salary" | "modality" | "company" | "seniority" | "location" | "tasks" | "requirements";

export type TransparencyInput = {
  title: string;
  company: string | null;
  jdText: string | null;
  locationRaw: string | null;
  countriesAllowed: readonly string[] | null;
  modality: string | null;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  yearsRequired: number | null;
};

export type TransparencyResult = {
  /** 0 a 10 en pasos de 0,5. */
  score: number;
  level: TransparencyLevel;
  /** Lo que el aviso no dice, en un orden fijo. */
  missing: TransparencyKey[];
};

/** Tope de caracteres del aviso que se revisan (un aviso real no pasa de unas decenas de miles). */
export const TRANSPARENCY_MAX_CHARS = 200_000;

const ORDER: readonly TransparencyKey[] = [
  "salary",
  "modality",
  "company",
  "seniority",
  "location",
  "tasks",
  "requirements",
];

const TASKS_RE =
  /responsabilidades|tareas|funciones|d[ií]a a d[ií]a|vas a (?:estar|trabajar|ser|armar|desarrollar|encargar)|responsibilities|what you(?:'|’)ll do|you will|duties/i;
const REQUIREMENTS_RE =
  /requisitos|requerimientos|requirements|qualifications|buscamos|perfil buscado|se requiere|must have|necesit[aá]s/i;
const SENIORITY_RE =
  /\b(?:trainee|pasante|junior|jr|semi[ -]?senior|ssr|senior|sr|lead|l[ií]der|mid)\b/i;
const HIDDEN_COMPANY_RE =
  /confidencial|confidential|an[oó]nim[ao]|anonymous|importante (?:empresa|compa)|empresa l[ií]der|cliente de/i;

export function transparencyLevel(score: number): TransparencyLevel {
  if (score >= 7.5) return "clear";
  if (score >= 4.5) return "partial";
  return "opaque";
}

function present(text: string | null): boolean {
  return Boolean(text && text.trim().length > 0);
}

export function jobTransparency(input: TransparencyInput): TransparencyResult {
  const body = (input.jdText ?? "").slice(0, TRANSPARENCY_MAX_CHARS);
  const company = input.company?.trim().slice(0, 200) ?? "";
  const modality = input.modality?.trim() ?? "";

  const has: Record<TransparencyKey, boolean> = {
    salary: Boolean(input.salaryMinUsd || input.salaryMaxUsd),
    modality: modality !== "" && modality !== "desconocida",
    company: company !== "" && !HIDDEN_COMPANY_RE.test(company),
    seniority: input.yearsRequired !== null || SENIORITY_RE.test(input.title.slice(0, 300)),
    location: present(input.locationRaw) || (input.countriesAllowed?.length ?? 0) > 0,
    tasks: TASKS_RE.test(body),
    requirements: REQUIREMENTS_RE.test(body),
  };

  const missing = ORDER.filter((k) => !has[k]);
  const score = Math.round(((10 * (ORDER.length - missing.length)) / ORDER.length) * 2) / 2;
  return { score, level: transparencyLevel(score), missing };
}
