/**
 * Lo que el turno sabe del CV confirmado (ADR-038 §5): los ítems leídos con RLS de `career_history`, los
 * nombres de las skills de la taxonomía y el puesto objetivo. Puro. De acá salen el ancla de cada problema
 * (para el validador de preguntas y las plantillas) y las fuentes contra las que se verifican los nombres
 * propios de una pregunta del modelo.
 */
import { foldCvText } from "../../cv-out/verify";
import type { CvIssue } from "../schemas";
import type { CoachFallbackVariant } from "./templates";

/**
 * Un ítem confirmado del CV. `section` sale de `career_history.kind` (trabajo → experience, proyecto →
 * projects, educacion y certificacion → education). Para un proyecto, `organization` es su nombre y
 * `title` su rol (ADR-038 §6).
 */
export type CvCoachItem = {
  /** Id de la fila de `career_history` (uuid). Es el `ref.itemId` de los problemas. */
  id: string;
  section: "experience" | "projects" | "education";
  organization: string;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
  /** Sigue ahí (sin fin). */
  isCurrent: boolean;
  bullets: readonly string[];
  link: string | null;
};

export type CvCoachTurnContext = {
  items: readonly CvCoachItem[];
  /** `slug` → nombre de la skill en la taxonomía. */
  skillNames: Readonly<Record<string, string>>;
  /** Puesto objetivo (el de la lista firmada). */
  target: string;
};

/** Ancla de un problema: con qué nombre lo menciona una pregunta. */
export type CoachAnchor = {
  variant: CoachFallbackVariant;
  /** El nombre (empresa, proyecto, skill o puesto); `null` si no hay. */
  value: string | null;
  /** Nombres completos que cuentan como mención (con límite de palabra a los dos lados). */
  names: string[];
  /** Raíces de palabra de la sección que también cuentan (solo para problemas de una sección entera). */
  stems: string[];
};

const SECTION_STEMS: Record<string, string[]> = {
  experience: ["experiencia", "trabaj"],
  projects: ["proyect"],
  education: ["estudi", "formaci", "educaci", "carrera", "curso"],
  skills: ["habilidad", "herramienta", "skill", "conocimiento"],
  summary: ["resumen", "perfil"],
};

export function coachItemFor(issue: CvIssue, ctx: CvCoachTurnContext): CvCoachItem | null {
  if (issue.ref.itemId === null) return null;
  const item = ctx.items.find((i) => i.id === issue.ref.itemId);
  return item && item.section === issue.ref.section ? item : null;
}

/** El nombre sin lo que viene después de una coma, un paréntesis o un guion («Empresa A (Retail)»). */
function shortName(name: string): string {
  return name.split(/\s*[,(|]\s*|\s+[-–—]\s+/u)[0]!.trim();
}

function namesOf(value: string | null): string[] {
  if (!value) return [];
  const full = value.replace(/\s+/g, " ").trim();
  const short = shortName(full);
  return [...new Set([full, short].filter((n) => n.length >= 2))];
}

export function coachIssueAnchor(issue: CvIssue, ctx: CvCoachTurnContext): CoachAnchor {
  const skill = issue.skillSlug ? (ctx.skillNames[issue.skillSlug] ?? null) : null;
  if (skill) return { variant: "habilidad", value: skill, names: namesOf(skill), stems: [] };
  const item = coachItemFor(issue, ctx);
  if (item) {
    const variant = item.section === "projects" ? "proyecto" : "organizacion";
    return { variant, value: item.organization, names: namesOf(item.organization), stems: [] };
  }
  // Problema de una sección entera (resumen, orden, skills): vale la sección o el puesto
  return {
    variant: "puesto",
    value: ctx.target,
    names: namesOf(ctx.target),
    stems: SECTION_STEMS[issue.ref.section] ?? [],
  };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿La pregunta menciona el ancla? Sobre texto plegado (sin acentos ni mayúsculas). */
export function mentionsAnchor(question: string, anchor: CoachAnchor): boolean {
  const q = foldCvText(question).replace(/\s+/g, " ");
  for (const n of anchor.names) {
    const f = foldCvText(n).replace(/\s+/g, " ").trim();
    if (
      f.length >= 2 &&
      new RegExp(`(?<![\\p{L}\\p{N}])${escape(f)}(?![\\p{L}\\p{N}])`, "u").test(q)
    ) {
      return true;
    }
  }
  return anchor.stems.some((s) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(s)}`, "u").test(q));
}

/**
 * Palabras con las que arranca o se arma una pregunta. Entran como fuente para que el verificador de nombres
 * propios no confunda «¿Cómo…?» o «¿Contame…» con un nombre inventado. Son palabras comunes: no habilitan
 * ninguna empresa ni tecnología.
 */
const QUESTION_WORDS =
  "qué que cómo como cuál cuáles cuándo cuando dónde donde cuánto cuánta cuántos cuántas quién quiénes " +
  "por para contame contanos contá decime decinos podés podrías tenés tuviste hay hubo hiciste hacías " +
  "usaste trabajaste lograste armaste estuviste empezaste terminaste querés te me en con de del y o si " +
  "sobre además bien genial perfecto gracias entonces ahora desde hasta antes después también tu tus " +
  "el la los las un una algún alguna alguno CV";

/**
 * Fuentes contra las que se verifica una pregunta del modelo: el CV confirmado, las skills de la
 * taxonomía, el puesto, lo que dijo la persona y las palabras de pregunta.
 */
export function coachQuestionSources(
  ctx: CvCoachTurnContext,
  messages: readonly string[],
): string[] {
  const cv = ctx.items.flatMap((i) => [i.organization, i.title, ...i.bullets]);
  return [...cv, ...Object.values(ctx.skillNames), ctx.target, ...messages, QUESTION_WORDS];
}
