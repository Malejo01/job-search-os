import type { CriteriaRules } from "../criteria";
import { foldText } from "../normalize/text";

/**
 * Prefiltro determinista, sin LLM, con SOLO los campos que trae un email de alerta
 * (título, empresa, ubicación, modalidad, badges, candidatos). Descarta únicamente por
 * bloqueadores duros (modalidad no remota, disciplina distinta) y por las reglas de título y
 * badge de CriteriaRules. Los riesgos (país no listado, LATAM sin países, muchos candidatos)
 * NUNCA descartan: se devuelven como flags para la UI y el evaluador.
 */
export type PrefilterInput = {
  title: string;
  companyRaw?: string | null;
  locationRaw?: string | null;
  modality?: "remoto" | "hibrido" | "presencial" | "desconocida" | null;
  badges?: readonly string[] | null;
  candidatesCount?: number | null;
  /** 0..1 si ya viene calculado; si no, se deriva del badge "X de Y aptitudes". */
  skillsMatchRatio?: number | null;
  /** Países del aviso si la fuente los trae estructurados (Get on Board). */
  countriesAllowed?: readonly string[] | null;
};

export type PrefilterReason =
  "modalidad_no_remota" | "disciplina_distinta" | "badge_aptitudes" | "titulo_blocklist";

export type PrefilterResult =
  | { pass: true; cap: number | null; flags: string[] }
  | { pass: false; reason: PrefilterReason; detail: string };

export type PrefilterOptions = {
  /** País del candidato (ISO-2). Default AR. */
  userCountry?: string;
  manyCandidatesFrom?: number;
};

const NON_REMOTE_IN_TEXT = /\b(hibrid[oa]|hybrid|presencial|on[\s-]?site|in[\s-]?office)\b/;
const AI_TITLE =
  /\b(ai|ia|llm|llms|gen\s?ai|genai|agentic|agents?|agente|inteligencia artificial)\b/;
const REMOTE_NO_COUNTRY = /\b(latam|latinoam[eé]rica|remote|remoto|anywhere)\b/;
const ANYWHERE = /\b(anywhere|worldwide|global)\b/;

/** "3 de 4 aptitudes coinciden" → 0.75; sin badge de aptitudes → null. */
export function skillsMatchRatioFromBadges(
  badges: readonly string[] | null | undefined,
): number | null {
  for (const b of badges ?? []) {
    const m = /(\d+)\s+de\s+(\d+)\s+aptitudes/i.exec(b) ?? /(\d+)\s+of\s+(\d+)\s+skills/i.exec(b);
    if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
  }
  return null;
}

const containsKeyword = (text: string, keywords: readonly string[]): string | null => {
  for (const k of keywords) {
    const kw = foldText(k).trim();
    if (!kw) continue;
    // "vp " en la blocklist lleva espacio a propósito: coincide "vp engineering", no "mvp"
    const re = new RegExp(
      `(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`,
    );
    if (re.test(text)) return k;
  }
  return null;
};

export function prefilter(
  input: PrefilterInput,
  rules: CriteriaRules,
  options: PrefilterOptions = {},
): PrefilterResult {
  const userCountry = (options.userCountry ?? "AR").toUpperCase();
  const manyFrom = options.manyCandidatesFrom ?? 100;
  const title = foldText(input.title);
  const location = foldText(input.locationRaw ?? "");
  const flags: string[] = [];

  // 1. Modalidad: bloqueador duro
  if (input.modality === "presencial" || input.modality === "hibrido") {
    return { pass: false, reason: "modalidad_no_remota", detail: `modalidad ${input.modality}` };
  }
  if (input.modality !== "remoto" && NON_REMOTE_IN_TEXT.test(location)) {
    return {
      pass: false,
      reason: "modalidad_no_remota",
      detail: `ubicación: ${input.locationRaw}`,
    };
  }

  // 2. Disciplina distinta por keywords en el título: bloqueador duro.
  //    ML engineer y evaluación de IA descartan siempre. Una keyword de dominio (growth, seo,
  //    pagos...) no descarta un título con señal clara de IA ("Senior AI Engineer — Growth",
  //    golden 30): es un rol de IA en ese dominio; queda como flag para el evaluador.
  const adjacent =
    containsKeyword(title, rules.ml_engineer_keywords) ??
    containsKeyword(title, rules.ai_eval_keywords);
  if (adjacent) {
    return {
      pass: false,
      reason: "disciplina_distinta",
      detail: `keyword '${adjacent}' en el título`,
    };
  }
  const domain = containsKeyword(title, rules.other_discipline_keywords);
  if (domain) {
    if (!AI_TITLE.test(title)) {
      return {
        pass: false,
        reason: "disciplina_distinta",
        detail: `keyword '${domain}' en el título`,
      };
    }
    flags.push(`domain_keyword:${domain}`);
  }

  // 3. Badge de aptitudes
  const ratio = input.skillsMatchRatio ?? skillsMatchRatioFromBadges(input.badges);
  if (ratio !== null && ratio < rules.skills_match_badge.discard_below) {
    return {
      pass: false,
      reason: "badge_aptitudes",
      detail: `aptitudes ${(ratio * 100).toFixed(0)}% < ${rules.skills_match_badge.discard_below * 100}%`,
    };
  }
  if (ratio !== null && ratio >= rules.skills_match_badge.analyze_from)
    flags.push("skills_match_high");

  // 4. Título en blocklist (salvo allowlist), con la excepción calibrada (caso golden 13)
  let cap: number | null = null;
  const allowed = containsKeyword(title, rules.title_allowlist);
  const blocked = allowed ? null : containsKeyword(title, rules.title_blocklist);
  if (blocked) {
    const exc = rules.title_cap_score_if_few_candidates;
    const fewCandidates =
      input.candidatesCount !== null &&
      input.candidatesCount !== undefined &&
      input.candidatesCount <= exc.max_candidates;
    const isAi = exc.disciplines.includes("ai_engineer") && AI_TITLE.test(title);
    if (fewCandidates && isAi) {
      cap = exc.cap;
      flags.push("title_cap");
    } else {
      return { pass: false, reason: "titulo_blocklist", detail: `'${blocked}' en el título` };
    }
  }

  // 5. Ubicación: riesgo, nunca descarte
  const countries = input.countriesAllowed?.map((c) => c.toUpperCase()) ?? null;
  if (countries?.length) {
    if (!countries.includes(userCountry) && !countries.includes("*")) flags.push("location_risk");
  } else if (REMOTE_NO_COUNTRY.test(location) && !ANYWHERE.test(location)) {
    // "LATAM", "remote", "remoto" sin país explícito del candidato
    const mentionsUser = location.includes(
      userCountry === "AR" ? "argentina" : userCountry.toLowerCase(),
    );
    if (!mentionsUser) flags.push("location_risk");
  }

  // 6. Candidatos: riesgo
  if (
    input.candidatesCount !== null &&
    input.candidatesCount !== undefined &&
    input.candidatesCount >= manyFrom
  ) {
    flags.push("many_candidates");
  }

  return { pass: true, cap, flags };
}
