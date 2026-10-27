import { isIsoCountry } from "../countries";
import { ENGLISH_RISK_LEVELS, type CriteriaFormValues } from "../criteria-form";
import { DISCIPLINES } from "../evaluation";
import { detectEvaluatorInjection } from "../evaluator/injection";
import { squash } from "../normalize/text";
import {
  CEFR_LEVELS,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
  MODALITIES,
  SUMMARY_IGNORED_SIGNALS,
} from "../onboarding";
import { err, ok, type Result } from "../result";
import { isEnglishSkillSlug } from "../skills/english";
import { SELF_LEVELS, type RoleKey } from "../skills/self-assessment";
import { parseTargetRoles } from "../skills/target-roles";
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
 * decide: cada valor tiene que citar literalmente lo que escribió la persona o su perfil (nunca
 * una respuesta del asistente ni el resultado de una tool: una JD no puede fundamentar un dato del
 * perfil), tiene que ser válido para el formulario de destino y tiene que cambiar algo. Lo que no
 * cumple se descarta con su motivo; si no queda nada, no hay propuesta.
 */

/** Textos contra los que se verifica una cita. Los arma el llamador con lo que ya cargó. */
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
  taxonomy: readonly { slug: string; name: string }[];
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

/** Minúsculas, sin acentos, comillas rectas y espacios colapsados: lo que importa es el texto. */
function normalizeForQuote(text: string): string {
  return squash(
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[‘’‚‛´`]/g, "'")
      .replace(/[“”„‟«»]/g, '"')
      .toLowerCase(),
  );
}

/** ¿La cita aparece literal en un mensaje de la persona o en su perfil, según dice `from`? */
export function isGrounded(g: Grounding, sources: GroundingSources): boolean {
  const quote = normalizeForQuote(g.quote);
  if (quote.length < 2) return false;
  const pool = g.from === "message" ? sources.userMessages : sources.profileTexts;
  return pool.some((text) => normalizeForQuote(text).includes(quote));
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
  return false;
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
      const list = MODALITIES.filter((m) => v.includes(m));
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
      const t = numText(v);
      if (t === null || !/^\d{1,2}(\.\d)?$/.test(t)) return null;
      const n = Number(t);
      return n >= 0 && n <= 60 ? String(n) : null;
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

function showProfile(field: ProfileField, v: ProfileSnapshot[ProfileField]): string {
  if (field === "acceptedModalities" && Array.isArray(v))
    return show(v.map((m) => MODALITY_LABEL[m] ?? m));
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

function finish(
  destination: ProposalDestination,
  diffs: FieldDiff[],
  formValues: Record<string, string | string[]>,
  dropped: Dropped[],
): Result<Proposal, ProposalFailure> {
  if (diffs.length === 0) return err({ code: "sin_cambios", dropped });
  return ok({
    destination,
    href: PROPOSAL_HREF[destination],
    title: PROPOSAL_TITLE[destination],
    diffs,
    formValues,
    dropped,
  });
}

/** Revisa fundamento y repetidos comunes a todos los destinos; devuelve el motivo o null. */
function precheck(
  field: string,
  source: Grounding,
  seen: Set<string>,
  sources: GroundingSources,
): DroppedReason | null {
  if (seen.has(field)) return "invalido";
  seen.add(field);
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
  const seen = new Set<string>();
  for (const change of parsed.data.changes) {
    const reason = precheck(change.field, change.source, seen, sources);
    if (reason) {
      dropped.push({ field: change.field, reason });
      continue;
    }
    const value = profileValue(change.field, change.value);
    if (value === null) {
      dropped.push({ field: change.field, reason: "invalido" });
      continue;
    }
    const before = current[change.field];
    if (sameValue(before, value)) {
      dropped.push({ field: change.field, reason: "sin_cambio" });
      continue;
    }
    (next as Record<ProfileField, unknown>)[change.field] = value;
    diffs.push({
      field: change.field,
      label: PROFILE_LABEL[change.field],
      before: showProfile(change.field, before),
      after: showProfile(change.field, value),
      source: change.source,
    });
  }
  return finish("profile", diffs, profileFormValues(next), dropped);
}

const levelLabel = (level: number | undefined): string =>
  level === undefined
    ? "sin nivel"
    : (SELF_LEVELS.find((l) => l.level === level)?.label ?? "sin nivel");

export function buildSkillLevelsProposal(
  input: unknown,
  current: SkillLevelsSnapshot,
  sources: GroundingSources,
): Result<Proposal, ProposalFailure> {
  const parsed = proposeSkillLevelsInput.safeParse(input);
  if (!parsed.success) return err({ code: "entrada_invalida", dropped: [] });
  const names = new Map(current.taxonomy.map((s) => [s.slug, s.name]));
  const diffs: FieldDiff[] = [];
  const formValues: Record<string, string> = {};
  const dropped: Dropped[] = [];
  const seen = new Set<string>();
  for (const change of parsed.data.changes) {
    const field = `level:${change.slug}`;
    // El inglés se deriva del CEFR del perfil, nunca de una fila suelta
    if (isEnglishSkillSlug(change.slug)) {
      dropped.push({ field, reason: "invalido" });
      continue;
    }
    if (!names.has(change.slug)) {
      dropped.push({ field, reason: "desconocido" });
      continue;
    }
    const reason = precheck(field, change.source, seen, sources);
    if (reason) {
      dropped.push({ field, reason });
      continue;
    }
    const before = current.levels[change.slug];
    if (before === change.level) {
      dropped.push({ field, reason: "sin_cambio" });
      continue;
    }
    formValues[field] = String(change.level);
    diffs.push({
      field,
      label: names.get(change.slug)!,
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
      if (v === "" || (typeof v === "string" && v.trim() === "")) return "";
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
      const list = DISCIPLINES.filter((d) => v.includes(d));
      return list.length ? list : null;
    }
  }
}

function showCriteria(
  field: CriteriaField,
  v: CriteriaValue,
  disciplineLabels: Readonly<Record<string, string>>,
): string {
  if (field === "salary_floor_usd_monthly") return v === "" ? "Sin piso" : `USD ${String(v)}`;
  if (field === "allowed_disciplines" && Array.isArray(v))
    return show(v.map((d) => disciplineLabels[d] ?? d));
  return show(v);
}

export function buildCriteriaProposal(
  input: unknown,
  current: CriteriaFormValues,
  sources: GroundingSources,
  disciplineLabels: Readonly<Record<string, string>> = {},
): Result<Proposal, ProposalFailure> {
  const parsed = proposeCriteriaInput.safeParse(input);
  if (!parsed.success) return err({ code: "entrada_invalida", dropped: [] });
  const next: CriteriaFormValues = structuredClone(current);
  const diffs: FieldDiff[] = [];
  const dropped: Dropped[] = [];
  const seen = new Set<string>();
  for (const change of parsed.data.changes) {
    const reason = precheck(change.field, change.source, seen, sources);
    if (reason) {
      dropped.push({ field: change.field, reason });
      continue;
    }
    const value = criteriaValue(change.field, change.value);
    if (value === null) {
      dropped.push({ field: change.field, reason: "invalido" });
      continue;
    }
    const before = current[change.field] as CriteriaValue;
    if (sameValue(before, value)) {
      dropped.push({ field: change.field, reason: "sin_cambio" });
      continue;
    }
    (next as Record<CriteriaField, unknown>)[change.field] = value;
    diffs.push({
      field: change.field,
      label: CRITERIA_LABEL[change.field],
      before: showCriteria(change.field, before, disciplineLabels),
      after: showCriteria(change.field, value, disciplineLabels),
      source: change.source,
    });
  }
  return finish("criteria", diffs, { ...next }, dropped);
}

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
  if (!roles.ok) return err({ code: "sin_cambios", dropped: [{ field, reason: "invalido" }] });
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
        ? buildCriteriaProposal(input, ctx.criteria, ctx.sources, ctx.disciplineLabels)
        : missing;
    case "propose_target_roles":
      return ctx.targetRoles
        ? buildTargetRolesProposal(input, ctx.targetRoles, ctx.sources, ctx.roleLabels)
        : missing;
  }
}
