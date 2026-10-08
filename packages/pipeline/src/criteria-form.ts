import { z } from "zod";
import type { CriteriaRules } from "./criteria";
import { DISCIPLINES } from "./evaluation";

/**
 * Criterios editables desde la app (JS-096). Puro: la app lee la versión vigente y pasa los datos;
 * acá solo se valida el formulario y se arma la versión siguiente. Lo que el formulario no edita
 * (topes de título, escalón de años, palabras de ML y de evaluación, penalizaciones) se copia
 * de la versión vigente sin cambios.
 */

export const MAX_LIST_ENTRIES = 100;
export const MAX_ENTRY_CHARS = 60;
export const ENGLISH_RISK_LEVELS = ["basico", "intermedio", "avanzado", "nativo"] as const;

/** Campos del formulario tal como llegan: texto, o varios valores en las casillas. */
export type CriteriaFormRaw = Record<string, string | string[] | undefined>;

export type CriteriaFormValues = {
  title_blocklist: string;
  title_allowlist: string;
  other_discipline_keywords: string;
  allowed_disciplines: string[];
  salary_floor_usd_monthly: string;
  max_weekly_hours: string;
  max_years_hard: string;
  english_risk_from: CriteriaRules["english_risk_from"];
  threshold_personalizado: string;
  threshold_aplicar: string;
  threshold_guardar: string;
};

export type CriteriaFormParse = { ok: true; rules: CriteriaRules } | { ok: false; field: string };

/** Valores para precargar el formulario: una entrada por línea. */
export function criteriaFormDefaults(current: CriteriaRules): CriteriaFormValues {
  return {
    title_blocklist: current.title_blocklist.join("\n"),
    title_allowlist: current.title_allowlist.join("\n"),
    other_discipline_keywords: current.other_discipline_keywords.join("\n"),
    allowed_disciplines: [...current.allowed_disciplines],
    salary_floor_usd_monthly: String(current.salary_floor_usd_monthly),
    max_weekly_hours: String(current.max_weekly_hours),
    max_years_hard: String(current.max_years_hard),
    english_risk_from: current.english_risk_from,
    threshold_personalizado: String(current.thresholds.personalizado),
    threshold_aplicar: String(current.thresholds.aplicar),
    threshold_guardar: String(current.thresholds.guardar),
  };
}

function hasControlChars(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Una entrada por línea, en minúscula y recortada. Una entrada que no cambió conserva la forma
 * que tenía en la versión vigente (p. ej. "vp " con su espacio final, que el prefiltro usa para
 * no coincidir con "vpn").
 */
function listField(current: string[]) {
  const byTrimmed = new Map(current.map((e) => [e.trim().toLowerCase(), e]));
  return z
    .string()
    .transform((text) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const line of text.split(/\r?\n/)) {
        const entry = line.trim().toLowerCase();
        if (entry === "" || seen.has(entry)) continue;
        seen.add(entry);
        out.push(entry);
      }
      return out;
    })
    .pipe(
      z
        .array(
          z
            .string()
            .max(MAX_ENTRY_CHARS)
            .refine((e) => !hasControlChars(e)),
        )
        .max(MAX_LIST_ENTRIES),
    )
    .transform((entries) => entries.map((e) => byTrimmed.get(e) ?? e));
}

function numberField(min: number, max: number, integer: boolean) {
  return z
    .string()
    .trim()
    .regex(integer ? /^\d{1,7}$/ : /^\d{1,2}(\.\d{1,2})?$/)
    .transform(Number)
    .pipe(z.number().min(min).max(max));
}

function schemaFor(current: CriteriaRules) {
  return z
    .object({
      title_blocklist: listField(current.title_blocklist),
      title_allowlist: listField(current.title_allowlist),
      other_discipline_keywords: listField(current.other_discipline_keywords),
      allowed_disciplines: z
        .array(z.enum(DISCIPLINES))
        .min(1)
        .transform((v) => DISCIPLINES.filter((d) => v.includes(d))),
      salary_floor_usd_monthly: numberField(0, 100000, true),
      max_weekly_hours: numberField(1, 80, true),
      max_years_hard: numberField(1, 40, true),
      english_risk_from: z.enum(ENGLISH_RISK_LEVELS),
      threshold_personalizado: numberField(0, 10, false),
      threshold_aplicar: numberField(0, 10, false),
      threshold_guardar: numberField(0, 10, false),
    })
    .superRefine((v, ctx) => {
      if (!(
        v.threshold_personalizado > v.threshold_aplicar && v.threshold_aplicar > v.threshold_guardar
      )) {
        ctx.addIssue({ code: "custom", path: ["thresholds"], message: "umbrales desordenados" });
      }
    });
}

/**
 * Valida el formulario y devuelve la versión siguiente de las reglas. Si falla, devuelve el primer
 * campo con error, sin eco del valor. `current` no se modifica.
 */
export function parseCriteriaForm(raw: CriteriaFormRaw, current: CriteriaRules): CriteriaFormParse {
  const text = (k: string) => {
    const v = raw[k];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };
  const disciplines = raw.allowed_disciplines;
  const parsed = schemaFor(current).safeParse({
    title_blocklist: text("title_blocklist"),
    title_allowlist: text("title_allowlist"),
    other_discipline_keywords: text("other_discipline_keywords"),
    allowed_disciplines: Array.isArray(disciplines)
      ? disciplines
      : disciplines
        ? [disciplines]
        : [],
    salary_floor_usd_monthly: text("salary_floor_usd_monthly"),
    max_weekly_hours: text("max_weekly_hours"),
    max_years_hard: text("max_years_hard"),
    english_risk_from: text("english_risk_from"),
    threshold_personalizado: text("threshold_personalizado"),
    threshold_aplicar: text("threshold_aplicar"),
    threshold_guardar: text("threshold_guardar"),
  });
  if (!parsed.success) {
    return { ok: false, field: String(parsed.error.issues[0]?.path[0] ?? "form") };
  }
  const v = parsed.data;
  return {
    ok: true,
    rules: {
      ...structuredClone(current),
      title_blocklist: v.title_blocklist,
      title_allowlist: v.title_allowlist,
      other_discipline_keywords: v.other_discipline_keywords,
      allowed_disciplines: v.allowed_disciplines,
      salary_floor_usd_monthly: v.salary_floor_usd_monthly,
      max_weekly_hours: v.max_weekly_hours,
      max_years_hard: v.max_years_hard,
      english_risk_from: v.english_risk_from,
      thresholds: {
        personalizado: v.threshold_personalizado,
        aplicar: v.threshold_aplicar,
        guardar: v.threshold_guardar,
      },
    },
  };
}
