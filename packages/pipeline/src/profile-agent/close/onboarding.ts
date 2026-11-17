/**
 * Onboarding con el agente (ADR-034 §9, R10-5). Lo completado se deriva de la base, sin banderas en la
 * URL: quien elige el CV saltea los pasos que el agente ya completó. Puro.
 */
import { detectCvInjection } from "../../cv/injection";
import { MAX_SUMMARY_CHARS } from "../../onboarding";
import { findProfileSensitive } from "../sensitive";

export interface ProfileAgentOnboardingFacts {
  /** Skills de la taxonomía con nivel mayor que 0 (`skill_levels`). */
  skillLevelCount: number;
  /** Skills propias (`user_skills`). */
  customSkillCount: number;
  /** Filas de `career_history` con `source = 'cv'` (las que guardó el agente). */
  cvHistoryCount: number;
}

/** ¿La persona ya pasó por el agente? Se deriva de lo que quedó en la base: sin banderas en la URL. */
export function profileAgentUsed(facts: ProfileAgentOnboardingFacts): boolean {
  return facts.cvHistoryCount > 0 || facts.skillLevelCount > 0 || facts.customSkillCount > 0;
}

/**
 * La elección «Subí tu CV y armamos tu perfil» / «Prefiero completarlo a mano» (decisión 1) aparece solo
 * con el agente encendido y mientras la persona no pasó por él. Con el flag apagado, nunca.
 */
export function profileAgentOnboardingChoiceVisible(
  agentEnabled: boolean,
  facts: ProfileAgentOnboardingFacts,
): boolean {
  return agentEnabled && !profileAgentUsed(facts);
}

export interface ProfileAgentFormPrefill {
  country?: string;
  acceptedModalities?: string[];
  summary?: string;
}

/**
 * Lo que el agente deja en el navegador y el formulario del perfil precarga, editable: el país y las
 * modalidades de la guía (todavía no se escriben, `saveProfileFromForm` los exige completos) y el resumen
 * verificado de `cv_write`. Solo completa lo que el formulario no trae ya. El resumen pasa la revisión de
 * `profileSummaryPrefill`; lo demás ya lo validó el esquema del estado.
 */
export function profileAgentFormPrefill(
  guide: { country?: string | undefined; modalities?: readonly string[] | undefined } | null,
  summary: unknown,
  current: { country: string; summary: string },
): ProfileAgentFormPrefill {
  const out: ProfileAgentFormPrefill = {};
  if (guide?.country && current.country === "") out.country = guide.country;
  if (guide?.modalities && guide.modalities.length > 0) {
    out.acceptedModalities = [...guide.modalities];
  }
  const s = profileSummaryPrefill(summary);
  if (s && current.summary.trim() === "") out.summary = s;
  return out;
}

/**
 * El paso 2 (skills) se saltea si el agente ya la completó: hay historial guardado desde el CV y skills con
 * nivel. Solo con el agente encendido: con el flag apagado el onboarding queda exactamente como hoy. Quien
 * cargó skills a mano, sin pasar por el agente, sigue viendo el paso.
 */
export function profileAgentSkipSkillsStep(
  agentEnabled: boolean,
  facts: ProfileAgentOnboardingFacts,
): boolean {
  if (!agentEnabled) return false;
  return facts.cvHistoryCount > 0 && (facts.skillLevelCount > 0 || facts.customSkillCount > 0);
}

/**
 * Resumen verificado de `cv_write` para precargar el campo del formulario (editable; lo guarda el
 * formulario con su validación, no el agente). Devuelve `null` si no pasa la revisión: un resumen con un
 * dato sensible o una instrucción escondida no se precarga.
 */
export function profileSummaryPrefill(summary: unknown): string | null {
  if (typeof summary !== "string") return null;
  const text = summary.trim();
  if (text === "" || text.length > MAX_SUMMARY_CHARS) return null;
  if (findProfileSensitive(text).length > 0 || detectCvInjection(text).hit) return null;
  return text;
}
