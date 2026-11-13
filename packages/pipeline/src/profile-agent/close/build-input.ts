/**
 * Cierre del agente de perfil (ADR-034 §1, R10-5): arma la entrada de `cv_write` con lo que la persona
 * confirmó y ya está en la base (historial, skills, inglés). Puro: el servidor lee las tablas con RLS y
 * pasa los datos; acá solo se revisan y se ordenan.
 *
 * El modelo nunca ve nada que no esté en la base: ni el texto del CV ni la charla. Cada entrada se
 * vuelve a revisar con el filtro de sensibles y el de inyección (los mismos de las tarjetas): una
 * entrada que no pasa se descarta entera, no se «limpia».
 */
import { detectCvInjection } from "../../cv/injection";
import type { CvHistoryInput, CvLang } from "../../cv-out/model";
import type { CvWriteInput } from "../../cv-chat/write";
import { findProfileSensitive } from "../sensitive";

/** Mismo tope que la carga manual y el chat de CV (`career_history`). */
export const PROFILE_AGENT_CLOSE_MAX_ENTRIES = 20;
export const PROFILE_AGENT_CLOSE_MAX_SKILLS = 40;
export const PROFILE_AGENT_CLOSE_MAX_LANGUAGES = 8;

export interface ProfileCloseFacts {
  lang: CvLang;
  /** Puesto principal (`profiles.target_roles[0]`, ya con su nombre legible) o `null`. */
  target: string | null;
  /** Filas de `career_history` de la persona, en su orden. */
  history: readonly (CvHistoryInput & { id?: string })[];
  /** Nombres de las skills confirmadas (taxonomía y propias). */
  skills: readonly string[];
  /** Idiomas para la vista previa: el inglés con su CEFR. */
  languages: readonly { name: string; level: string | null }[];
}

export interface ProfileCloseWriteBuild {
  input: CvWriteInput;
  /** `id` de la fila de `career_history` de cada entrada de `input.history` (misma posición), o `null`. */
  historyIds: (string | null)[];
  /** Cuántas entradas, skills o idiomas se dejaron afuera por sensibles, inyección o tope. */
  dropped: number;
  /** ¿Hay al menos un trabajo? Sin trabajos no se llama al modelo: el CV sale con el texto de la persona. */
  hasWork: boolean;
}

function clean(texts: readonly string[]): boolean {
  return texts.every((t) => findProfileSensitive(t).length === 0 && !detectCvInjection(t).hit);
}

const fmtLanguage = (l: { name: string; level: string | null }): string =>
  l.level ? `${l.name}: ${l.level}` : l.name;

export function buildProfileCloseWriteInput(facts: ProfileCloseFacts): ProfileCloseWriteBuild {
  let dropped = 0;
  const history: CvHistoryInput[] = [];
  const historyIds: (string | null)[] = [];
  for (const h of facts.history) {
    if (
      history.length >= PROFILE_AGENT_CLOSE_MAX_ENTRIES ||
      !clean([h.organization, h.title, ...h.bullets])
    ) {
      dropped++;
      continue;
    }
    history.push({
      kind: h.kind,
      organization: h.organization,
      title: h.title,
      startMonth: h.startMonth,
      endMonth: h.endMonth,
      bullets: [...h.bullets],
    });
    historyIds.push(h.id ?? null);
  }
  const skills: string[] = [];
  for (const name of facts.skills) {
    if (skills.some((k) => k.toLowerCase() === name.toLowerCase())) continue;
    if (skills.length >= PROFILE_AGENT_CLOSE_MAX_SKILLS || !clean([name])) {
      dropped++;
      continue;
    }
    skills.push(name);
  }
  const languages: string[] = [];
  for (const l of facts.languages) {
    const text = fmtLanguage(l);
    if (languages.length >= PROFILE_AGENT_CLOSE_MAX_LANGUAGES || !clean([text])) {
      dropped++;
      continue;
    }
    languages.push(text);
  }
  const target = facts.target !== null && clean([facts.target]) ? facts.target : null;
  return {
    input: { lang: facts.lang, target, history, skills, languages },
    historyIds,
    dropped,
    hasWork: history.some((h) => h.kind === "trabajo"),
  };
}
