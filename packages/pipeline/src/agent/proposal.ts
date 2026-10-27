import { isIsoCountry } from "../countries";
import { ENGLISH_RISK_LEVELS, type CriteriaFormValues } from "../criteria-form";
import { DISCIPLINES } from "../evaluation";
import { detectEvaluatorInjection } from "../evaluator/injection";
import { foldText, squash } from "../normalize/text";
import {
  CEFR_LEVELS,
  COUNTRY_OPTIONS,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
  MODALITIES,
  parseOnboarding,
  SUMMARY_IGNORED_SIGNALS,
} from "../onboarding";
import { err, ok, type Result } from "../result";
import { isEnglishSkillSlug } from "../skills/english";
import { SELF_LEVELS, selectableRoleGroups, type RoleKey } from "../skills/self-assessment";
import { parseTargetRoles } from "../skills/target-roles";
import { CV_OMITTED_MARKER, looksLikeCv } from "./cv-detect";
import type { AgentMessage } from "./history";
import {
  proposeCriteriaInput,
  proposeProfileInput,
  proposeSkillLevelsInput,
  proposeTargetRolesInput,
  type AgentProposeTool,
  type CriteriaField,
  type ProfileField,
} from "./tools";
import type {
  DroppedReason,
  FieldDiff,
  Grounding,
  Proposal,
  ProposalDestination,
  ProposalError,
} from "./types";

/**
 * Diferencias por destino y regla de fundamento del asistente. El modelo propone y el código
 * decide. Cada cambio tiene que:
 * 1. citar literalmente lo que escribió la persona o su perfil, con al menos 8 caracteres y 2
 *    palabras (nunca una respuesta del asistente ni el resultado de una tool: una JD no puede
 *    fundamentar un dato del perfil);
 * 2. llevar el valor DENTRO de la cita cuando el campo lo permite: números, nivel de inglés, país,
 *    ciudad y nombre de la skill. Límite conocido: en los campos de opciones (modalidades, idioma
 *    de las ofertas, autorizaciones, inglés que marca riesgo, disciplinas) y en los puestos solo
 *    rige la regla 1, porque la persona los dice con palabras que no son la clave; tampoco se
 *    detectan negaciones («todavía no tengo 5 años»). Por eso nada se escribe sin su clic;
 * 3. ser válido para el formulario de destino y cambiar algo.
 * El resumen no lo redacta el modelo: proponerlo es agregar al final la cita de la persona.
 * Lo que no cumple se descarta con su motivo; si no queda nada, no hay propuesta.
 */

/** Textos contra los que se verifica una cita. Se arman con `groundingSourcesFrom`. */
export type GroundingSources = {
  /** Mensajes de la persona en esta conversación (nunca los del asistente). */
  userMessages: readonly string[];
  /** Textos del perfil guardado (resumen, ciudad…). */
  profileTexts: readonly string[];
};

/** Mismos campos que `ProfileFormValues` de la app (lo que precarga «Tu perfil»). */
export type ProfileSnapshot = {
  country: string;
  city: string;
  acceptedModalities: string[];
  jobLanguage: "es" | "en" | "both";
  workAuthUs: boolean;
  workAuthEu: boolean;
  workAuthOther: string[];
  englishCefr: string;
  yearsTotal: string;
  summary: string;
};

export type SkillLevelsSnapshot = {
  /** slug → nivel guardado (0..3). */
  levels: Readonly<Record<string, number>>;
  taxonomy: readonly { slug: string; name: string; aliases?: readonly string[] }[];
};

export type TargetRolesSnapshot = { roles: readonly RoleKey[]; limit: number };

export type ProposalFailure = {
  code: ProposalError;
  dropped: Proposal["dropped"];
};

type Dropped = Proposal["dropped"][number];

const PROPOSAL_HREF: Record<ProposalDestination, string> = {
  profile: "/settings/perfil",
  skill_levels: "/settings/skills",
  criteria: "/settings/criteria",
  target_roles: "/settings#puesto",
};

const PROPOSAL_TITLE: Record<ProposalDestination, string> = {
  profile: "Cambios para Tu perfil",
  skill_levels: "Cambios para Tus skills",
  criteria: "Cambios para Criterios",
  target_roles: "Cambios para Tus puestos",
};

/** Caracteres de formato invisibles (bidi, ancho cero): no van en citas ni en textos propuestos. */
const FORMAT_CHARS = /\p{Cf}/u;

const MIN_QUOTE_CHARS = 8;
const MAX_GROUNDING_MESSAGE_CHARS = 600;

/** Comillas rectas, sin acentos, minúsculas y espacios colapsados: lo que importa es el texto. */
function normalizeForQuote(text: string): string {
  // Los reemplazos van antes de NFKD: después, «´» ya se descompuso en espacio + acento
  const straight = text.replace(/[‘’‚‛´`]/g, "'").replace(/[“”„‟«»]/g, '"');
  return squash(foldText(straight));
}

const wordCount = (text: string): number =>
  text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** ¿La cita aparece literal en un mensaje de la persona o en su perfil, según dice `from`? */
export function isGrounded(g: Grounding, sources: GroundingSources): boolean {
  if (FORMAT_CHARS.test(g.quote)) return false;
  const quote = normalizeForQuote(g.quote);
  if (quote.length < MIN_QUOTE_CHARS || wordCount(quote) < 2) return false;
  const pool = g.from === "message" ? sources.userMessages : sources.profileTexts;
  return pool.some((text) => normalizeForQuote(text).includes(quote));
}

/**
 * Fuentes de fundamento a partir del historial: solo los mensajes de la persona, y no los que son
 * un CV (o su marcador), los que traen frases dirigidas al modelo ni los de más de 600 caracteres
 * (un texto pegado de afuera no es lo que la persona dice de sí misma).
 */
export function groundingSourcesFrom(
  messages: readonly AgentMessage[],
  profileTexts: readonly string[],
): GroundingSources {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => m.text)
    .filter(
      (text) =>
        text !== CV_OMITTED_MARKER &&
        text.length <= MAX_GROUNDING_MESSAGE_CHARS &&
        !looksLikeCv(text) &&
        !detectEvaluatorInjection(text).signals.some(
          (name) => !SUMMARY_IGNORED_SIGNALS.includes(name),
        ),
    );
  return { userMessages, profileTexts: [...profileTexts] };
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿`term` aparece en `text` como palabra entera? Los dos ya normalizados. */
function hasWord(text: string, term: string): boolean {
  if (term === "") return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

/**
 * Números enteros que aparecen en la cita (no pegados a una letra ni a otro dígito), con y sin
 * separadores: «1.500» y «1500» valen 1500; «2,5» vale también 2,5.
 */
function numbersIn(quote: string): number[] {
  const out: number[] = [];
  for (const m of quote.matchAll(/(?<![\p{L}\d.,])\d(?:[\d.,]*\d)?(?!\d)/gu)) {
    const token = m[0];
    out.push(Number(token.replace(/[.,]/g, "")));
    if (/^\d+[.,]\d{1,2}$/.test(token)) out.push(Number(token.replace(",", ".")));
  }
  return out;
}

const numberInQuote = (value: string, quote: string): boolean =>
  numbersIn(quote).includes(Number(value));

let regionNames: Intl.DisplayNames | null | undefined;

/** Nombre del país en español, plegado; null si el entorno no tiene los nombres. */
function countryNameEs(code: string): string | null {
  const option = COUNTRY_OPTIONS.find((c) => c.code === code);
  if (option) return normalizeForQuote(option.label);
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["es"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  const name = regionNames?.of(code);
  return name && name !== code ? normalizeForQuote(name) : null;
}

function countryInQuote(code: string, quote: string): boolean {
  if (hasWord(quote, code.toLowerCase())) return true;
  const name = countryNameEs(code);
  return name !== null && quote.includes(name);
}

/** ¿El valor propuesto aparece en la cita? Solo para los campos donde se puede verificar. */
function profileValueInQuote(
  field: ProfileField,
  value: ProfileSnapshot[ProfileField],
  current: ProfileSnapshot,
  rawQuote: string,
): boolean {
  const quote = normalizeForQuote(rawQuote);
  switch (field) {
    case "yearsTotal":
      return numberInQuote(String(value), quote);
    case "englishCefr":
      return hasWord(quote, String(value).toLowerCase());
    case "country":
      return countryInQuote(String(value), quote);
    case "workAuthOther":
      return (value as string[])
        .filter((c) => !current.workAuthOther.includes(c))
        .every((c) => countryInQuote(c, quote));
    case "city": {
      const city = normalizeForQuote(String(value));
      // Borrar la ciudad (vacío) solo exige la cita
      return city === "" || quote.includes(city);
    }
    default:
      return true;
  }
}

const show = (v: string | readonly string[] | boolean): string => {
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  const s = (v as string).trim();
  return s === "" ? "—" : s;
};

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function hasControlChars(text: string, allowNewlines = false): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (allowNewlines && code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return FORMAT_CHARS.test(text);
}

/** Normaliza un valor numérico propuesto a string (el formulario trabaja con strings). */
function numText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") return v.trim();
  return null;
}

function intInRange(v: unknown, min: number, max: number): string | null {
  const t = numText(v);
  if (t === null || !/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? String(n) : null;
}

/** Lista en el orden canónico de `all` (comparar como conjunto, no por orden). */
const canonical = <T extends string>(all: readonly T[], list: readonly string[]): T[] =>
  all.filter((x) => list.includes(x));

const MODALITY_LABEL: Record<string, string> = {
  remoto: "Remoto",
  hibrido: "Híbrido",
  presencial: "Presencial",
};
const JOB_LANGUAGE_LABEL: Record<ProfileSnapshot["jobLanguage"], string> = {
  es: "Español",
  en: "Inglés",
  both: "Español e inglés",
};

const PROFILE_LABEL: Record<ProfileField, string> = {
  country: "País",
  city: "Ciudad",
  acceptedModalities: "Modalidades",
  jobLanguage: "Idioma de las ofertas",
  workAuthUs: "Autorización para trabajar en EE. UU.",
  workAuthEu: "Autorización para trabajar en la UE",
  workAuthOther: "Otros países donde podés trabajar",
  englishCefr: "Nivel de inglés",
  yearsTotal: "Años de experiencia",
  summary: "Resumen",
};

/** Valor válido para un campo de «Tu perfil», ya normalizado; null = inválido. */
function profileValue(field: ProfileField, v: unknown): ProfileSnapshot[ProfileField] | null {
  switch (field) {
    case "country": {
      if (typeof v !== "string") return null;
      const c = v.trim().toUpperCase();
      return c !== "XX" && isIsoCountry(c) ? c : null;
    }
    case "city": {
      if (typeof v !== "string") return null;
      const c = v.trim();
      return c.length <= 100 && !hasControlChars(c) ? c : null;
    }
    case "acceptedModalities": {
      if (!Array.isArray(v)) return null;
      if (!v.every((m) => (MODALITIES as readonly string[]).includes(m))) return null;
      const list = canonical(MODALITIES, v);
      return list.length ? list : null;
    }
    case "jobLanguage":
      return v === "es" || v === "en" || v === "both" ? v : null;
    case "workAuthUs":
    case "workAuthEu":
      return typeof v === "boolean" ? v : null;
    case "workAuthOther": {
      if (!Array.isArray(v)) return null;
      const codes = [...new Set(v.map((c) => String(c).trim().toUpperCase()))];
      return codes.length <= 10 && codes.every((c) => c !== "XX" && isIsoCountry(c)) ? codes : null;
    }
    case "englishCefr": {
      if (typeof v !== "string") return null;
      const c = v.trim().toUpperCase();
      return (CEFR_LEVELS as readonly string[]).includes(c) ? c : null;
    }
    case "yearsTotal": {
      // Múltiplos de 0,5: el campo del formulario tiene step="0.5"
      const t = numText(v);
      if (t === null || !/^\d{1,2}(\.\d)?$/.test(t)) return null;
      const n = Number(t);
      return n >= 0 && n <= 60 && Number.isInteger(n * 2) ? String(n) : null;
    }
    case "summary": {
      if (typeof v !== "string") return null;
      const s = v.replace(/\r\n?/g, "\n").trim();
      if (s.length < MIN_SUMMARY_CHARS || s.length > MAX_SUMMARY_CHARS) return null;
      if (hasControlChars(s, true)) return null;
      // Mismo filtro que el guardado del perfil: el resumen entra al prompt del evaluador
      const signals = detectEvaluatorInjection(s).signals.filter(
        (name) => !SUMMARY_IGNORED_SIGNALS.includes(name),
      );
      return signals.length ? null : s;
    }
  }
}

/** Valor de un campo del perfil para comparar (las modalidades, como conjunto). */
function profileComparable(field: ProfileField, v: ProfileSnapshot[ProfileField]): unknown {
  return field === "acceptedModalities" && Array.isArray(v) ? canonical(MODALITIES, v) : v;
}

function showProfile(field: ProfileField, v: ProfileSnapshot[ProfileField]): string {
  if (field === "acceptedModalities" && Array.isArray(v))
    return show(canonical(MODALITIES, v).map((m) => MODALITY_LABEL[m] ?? m));
  if (field === "jobLanguage" && typeof v === "string")
    return JOB_LANGUAGE_LABEL[v as ProfileSnapshot["jobLanguage"]] ?? v;
  return show(v);
}

/** Valores del perfil en el formato del formulario: las casillas, "on" o vacío. */
function profileFormValues(p: ProfileSnapshot): Record<string, string | string[]> {
  return {
    country: p.country,
    city: p.city,
    acceptedModalities: [...p.acceptedModalities],
    jobLanguage: p.jobLanguage,
    workAuthUs: p.workAuthUs ? "on" : "",
    workAuthEu: p.workAuthEu ? "on" : "",
    workAuthOther: [...p.workAuthOther],
    englishCefr: p.englishCefr,
    yearsTotal: p.yearsTotal,
    summary: p.summary,
  };
}

/**
 * Campo del formulario de «Tu perfil» que rechazaría el guardado, o null. Usa el mismo
 * `parseOnboarding` que la Server Action; los puestos, el piso y las horas no se editan en ese
 * formulario (la acción usa los guardados), así que acá van con valores neutros.
 */
function profileFormError(p: ProfileSnapshot): string | null {
  const parsed = parseOnboarding(
    { ...profileFormValues(p), targetRoles: ["frontend"], salaryFloorUsd: "", maxWeeklyHours: "" },
    1,
  );
  if (parsed.ok) return null;
  return parsed.field === "profileSummary" ? "summary" : parsed.field;
}

function finish(
  destination: ProposalDestination,
  diffs: FieldDiff[],
  formValues: Record<string, string | string[]>,
  dropped: Dropped[],
  warnings: string[] = [],
  criteriaVersion?: number,
): Result<Proposal, ProposalFailure> {
  if (diffs.length === 0) return err({ code: "sin_cambios", dropped });
  // Solo los campos que cambian: el cargador no toca nada más del formulario
  const changed = new Set(diffs.map((d) => d.field));
  const onlyChanged = Object.fromEntries(
    Object.entries(formValues).filter(([name]) => changed.has(name)),
  );
  return ok({
    destination,
    href: PROPOSAL_HREF[destination],
    title: PROPOSAL_TITLE[destination],
    diffs,
    formValues: onlyChanged,
    dropped,
    warnings,
    ...(criteriaVersion !== undefined ? { criteriaVersion } : {}),
  });
}

/**
 * Revisa repetidos y la cita (regla 1). El campo se marca como visto recién cuando el cambio se
 * acepta: un primer intento descartado no bloquea uno bueno después.
 */
function precheck(
  field: string,
  source: Grounding,
  accepted: ReadonlySet<string>,
  sources: GroundingSources,
): DroppedReason | null {
  if (accepted.has(field)) return "invalido";
  return isGrounded(source, sources) ? null : "sin_fundamento";
}

export function buildProfileProposal(
  input: unknown,
  current: ProfileSnapshot,
  sources: GroundingSources,
): Result<Proposal, ProposalFailure> {
  const parsed = proposeProfileInput.safeParse(input);
  if (!parsed.success) return err({ code: "entrada_invalida", dropped: [] });
  const next: ProfileSnapshot = structuredClone(current);
  const diffs: FieldDiff[] = [];
  const dropped: Dropped[] = [];
  const accepted = new Set<string>();
  for (const change of parsed.data.changes) {
    const { field, source } = change;
    const reason = precheck(field, source, accepted, sources);
    if (reason) {
      dropped.push({ field, reason });
      continue;
    }
    // El resumen no lo redacta el modelo: se agrega al final la cita de la persona
    let raw: unknown = change.value;
    if (field === "summary") {
      if (source.from !== "message") {
        dropped.push({ field, reason: "invalido" });
        continue;
      }
      const base = current.summary.trim();
      const quote = source.quote.trim();
      raw = base ? `${base}\n\n${quote}` : quote;
    }
    const value = profileValue(field, raw);
    if (value === null) {
      dropped.push({ field, reason: "invalido" });
      continue;
    }
    if (!profileValueInQuote(field, value, current, source.quote)) {
      dropped.push({ field, reason: "sin_fundamento" });
      continue;
    }
    const before = current[field];
    if (sameValue(profileComparable(field, before), profileComparable(field, value))) {
      dropped.push({ field, reason: "sin_cambio" });
      continue;
    }
    accepted.add(field);
    (next as Record<ProfileField, unknown>)[field] = value;
    diffs.push({
      field,
      label: PROFILE_LABEL[field],
      before: showProfile(field, before),
      after: showProfile(field, value),
      source,
    });
  }

  // El formulario entero tiene que poder guardarse: un cambio propuesto que lo rompe se descarta;
  // un campo guardado que ya no pasa se avisa
  const warnings: string[] = [];
  for (let guard = 0; guard <= diffs.length; guard++) {
    const field = profileFormError(next);
    if (field === null) break;
    const i = diffs.findIndex((d) => d.field === field);
    if (i < 0) {
      warnings.push(field);
      break;
    }
    (next as Record<string, unknown>)[field] = current[field as ProfileField];
    diffs.splice(i, 1);
    dropped.push({ field, reason: "invalido" });
  }
  return finish("profile", diffs, profileFormValues(next), dropped, warnings);
}

const levelLabel = (level: number | undefined): string =>
  level === undefined
    ? "sin nivel"
    : (SELF_LEVELS.find((l) => l.level === level)?.label ?? "sin nivel");

/**
 * Niveles de skills. `formValues` trae solo `level:<slug>` de lo que cambia; una skill de la
 * taxonomía puede no tener fila visible en el formulario (no es de la carrera de la persona): el
 * cargador de la app (AG-3) agrega un input oculto para esos slugs.
 */
export function buildSkillLevelsProposal(
  input: unknown,
  current: SkillLevelsSnapshot,
  sources: GroundingSources,
): Result<Proposal, ProposalFailure> {
  const parsed = proposeSkillLevelsInput.safeParse(input);
  if (!parsed.success) return err({ code: "entrada_invalida", dropped: [] });
  const bySlug = new Map(current.taxonomy.map((s) => [s.slug, s]));
  const diffs: FieldDiff[] = [];
  const formValues: Record<string, string> = {};
  const dropped: Dropped[] = [];
  const accepted = new Set<string>();
  for (const change of parsed.data.changes) {
    const field = `level:${change.slug}`;
    // El inglés se deriva del CEFR del perfil, nunca de una fila suelta
    if (isEnglishSkillSlug(change.slug)) {
      dropped.push({ field, reason: "invalido" });
      continue;
    }
    const skill = bySlug.get(change.slug);
    if (!skill) {
      // Sin el slug: lo inventó el modelo y no tiene por qué llegar a un log
      dropped.push({ field: "level:?", reason: "desconocido" });
      continue;
    }
    const reason = precheck(field, change.source, accepted, sources);
    if (reason) {
      dropped.push({ field, reason });
      continue;
    }
    const quote = normalizeForQuote(change.source.quote);
    const names = [skill.name, skill.slug, skill.slug.replace(/_/g, " "), ...(skill.aliases ?? [])];
    if (!names.some((n) => hasWord(quote, normalizeForQuote(n)))) {
      dropped.push({ field, reason: "sin_fundamento" });
      continue;
    }
    const before = current.levels[change.slug];
    if (before === change.level) {
      dropped.push({ field, reason: "sin_cambio" });
      continue;
    }
    accepted.add(field);
    formValues[field] = String(change.level);
    diffs.push({
      field,
      label: skill.name,
      before: levelLabel(before),
      after: levelLabel(change.level),
      source: change.source,
    });
  }
  return finish("skill_levels", diffs, formValues, dropped);
}

const CRITERIA_LABEL: Record<CriteriaField, string> = {
  salary_floor_usd_monthly: "Piso salarial (USD por mes)",
  max_weekly_hours: "Horas semanales máximas",
  max_years_hard: "Años de experiencia máximos que pide un aviso",
  english_risk_from: "Inglés que marca riesgo desde",
  allowed_disciplines: "Disciplinas",
};

type CriteriaValue = string | string[];

function criteriaValue(field: CriteriaField, v: unknown): CriteriaValue | null {
  switch (field) {
    case "salary_floor_usd_monthly": {
      // Vacío = sin piso
      if (typeof v === "string" && v.trim() === "") return "";
      return intInRange(v, 0, 100000);
    }
    case "max_weekly_hours":
      return intInRange(v, 1, 80);
    case "max_years_hard":
      return intInRange(v, 1, 40);
    case "english_risk_from":
      return typeof v === "string" && (ENGLISH_RISK_LEVELS as readonly string[]).includes(v)
        ? v
        : null;
    case "allowed_disciplines": {
      if (!Array.isArray(v)) return null;
      if (!v.every((d) => (DISCIPLINES as readonly string[]).includes(d))) return null;
      const list = canonical(DISCIPLINES, v);
      return list.length ? list : null;
    }
  }
}

function criteriaValueInQuote(field: CriteriaField, value: CriteriaValue, quote: string): boolean {
  if (field === "salary_floor_usd_monthly" && value === "") return true;
  if (
    field === "salary_floor_usd_monthly" ||
    field === "max_weekly_hours" ||
    field === "max_years_hard"
  ) {
    return numberInQuote(String(value), normalizeForQuote(quote));
  }
  return true;
}

const criteriaComparable = (field: CriteriaField, v: CriteriaValue): unknown =>
  field === "allowed_disciplines" && Array.isArray(v) ? canonical(DISCIPLINES, v) : v;

function showCriteria(
  field: CriteriaField,
  v: CriteriaValue,
  disciplineLabels: Readonly<Record<string, string>>,
): string {
  if (field === "salary_floor_usd_monthly") return v === "" ? "Sin piso" : `USD ${String(v)}`;
  if (field === "allowed_disciplines" && Array.isArray(v))
    return show(canonical(DISCIPLINES, v).map((d) => disciplineLabels[d] ?? d));
  return show(v);
}

export function buildCriteriaProposal(
  input: unknown,
  current: CriteriaFormValues,
  sources: GroundingSources,
  disciplineLabels: Readonly<Record<string, string>> = {},
  criteriaVersion?: number,
): Result<Proposal, ProposalFailure> {
  const parsed = proposeCriteriaInput.safeParse(input);
  if (!parsed.success) return err({ code: "entrada_invalida", dropped: [] });
  const next: CriteriaFormValues = structuredClone(current);
  const diffs: FieldDiff[] = [];
  const dropped: Dropped[] = [];
  const accepted = new Set<string>();
  for (const change of parsed.data.changes) {
    const { field, source } = change;
    const reason = precheck(field, source, accepted, sources);
    if (reason) {
      dropped.push({ field, reason });
      continue;
    }
    const value = criteriaValue(field, change.value);
    if (value === null) {
      dropped.push({ field, reason: "invalido" });
      continue;
    }
    if (!criteriaValueInQuote(field, value, source.quote)) {
      dropped.push({ field, reason: "sin_fundamento" });
      continue;
    }
    const before = current[field] as CriteriaValue;
    if (sameValue(criteriaComparable(field, before), criteriaComparable(field, value))) {
      dropped.push({ field, reason: "sin_cambio" });
      continue;
    }
    accepted.add(field);
    (next as Record<CriteriaField, unknown>)[field] = value;
    diffs.push({
      field,
      label: CRITERIA_LABEL[field],
      before: showCriteria(field, before, disciplineLabels),
      after: showCriteria(field, value, disciplineLabels),
      source,
    });
  }
  return finish("criteria", diffs, { ...next }, dropped, [], criteriaVersion);
}

/**
 * Puestos: la lista completa y ordenada (el primero es el principal). Solo las carreras que el
 * formulario muestra como casilla (`selectableRoleGroups`, que conserva las no listadas que la
 * persona ya tiene).
 */
export function buildTargetRolesProposal(
  input: unknown,
  current: TargetRolesSnapshot,
  sources: GroundingSources,
  roleLabels: Readonly<Partial<Record<RoleKey, string>>> = {},
): Result<Proposal, ProposalFailure> {
  const parsed = proposeTargetRolesInput.safeParse(input);
  if (!parsed.success) return err({ code: "entrada_invalida", dropped: [] });
  const field = "targetRoles";
  if (!isGrounded(parsed.data.source, sources)) {
    return err({ code: "sin_cambios", dropped: [{ field, reason: "sin_fundamento" }] });
  }
  const roles = parseTargetRoles(parsed.data.roles, current.limit);
  const selectable = selectableRoleGroups(current.roles).flatMap((g) => g.roles);
  if (!roles.ok || !roles.roles.every((r) => selectable.includes(r))) {
    return err({ code: "sin_cambios", dropped: [{ field, reason: "invalido" }] });
  }
  if (sameValue([...current.roles], roles.roles)) {
    return err({ code: "sin_cambios", dropped: [{ field, reason: "sin_cambio" }] });
  }
  const label = (list: readonly RoleKey[]) => show(list.map((r) => roleLabels[r] ?? r));
  return finish(
    "target_roles",
    [
      {
        field,
        label: "Tus puestos",
        before: label(current.roles),
        after: label(roles.roles),
        source: parsed.data.source,
      },
    ],
    { targetRoles: [...roles.roles] },
    [],
  );
}

/** Lo que el llamador ya cargó para armar una propuesta. Falta el destino pedido → sin contexto. */
export type ProposalContext = {
  sources: GroundingSources;
  profile?: ProfileSnapshot;
  skills?: SkillLevelsSnapshot;
  criteria?: CriteriaFormValues;
  /** Versión de los criterios con la que se arma la propuesta (el form la compara con la suya). */
  criteriaVersion?: number;
  targetRoles?: TargetRolesSnapshot;
  roleLabels?: Readonly<Partial<Record<RoleKey, string>>>;
  disciplineLabels?: Readonly<Record<string, string>>;
};

export function buildProposal(
  tool: AgentProposeTool,
  input: unknown,
  ctx: ProposalContext,
): Result<Proposal, ProposalFailure> {
  const missing = err<ProposalFailure>({ code: "sin_contexto", dropped: [] });
  switch (tool) {
    case "propose_profile":
      return ctx.profile ? buildProfileProposal(input, ctx.profile, ctx.sources) : missing;
    case "propose_skill_levels":
      return ctx.skills ? buildSkillLevelsProposal(input, ctx.skills, ctx.sources) : missing;
    case "propose_criteria":
      return ctx.criteria
        ? buildCriteriaProposal(
            input,
            ctx.criteria,
            ctx.sources,
            ctx.disciplineLabels,
            ctx.criteriaVersion,
          )
        : missing;
    case "propose_target_roles":
      return ctx.targetRoles
        ? buildTargetRolesProposal(input, ctx.targetRoles, ctx.sources, ctx.roleLabels)
        : missing;
  }
}

/**
 * Lo único de una propuesta que puede ir a un log o a una métrica: destino, nombres de campo y
 * motivos de descarte. Nunca citas, valores ni etiquetas.
 */
export function proposalLogMeta(p: Proposal | ProposalFailure): {
  destination?: ProposalDestination;
  fields: string[];
  dropped: { field: string; reason: DroppedReason }[];
} {
  const dropped = p.dropped.map((d) => ({ field: d.field, reason: d.reason }));
  if ("destination" in p) {
    return { destination: p.destination, fields: p.diffs.map((d) => d.field), dropped };
  }
  return { fields: [], dropped };
}
