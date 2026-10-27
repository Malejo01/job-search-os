/**
 * Estado y temario del chat de CV (C-25). El temario lo decide este checklist determinista a partir de lo
 * confirmado y lo extraído hasta ahora; el modelo solo formula la pregunta del tema y extrae la respuesta.
 * Todo es inmutable y puro: cada función devuelve un estado nuevo.
 */
import { cleanCvText, CV_BULLET_MAX_CHARS } from "../cv-out/verify";
import { CV_MAX_BULLETS, type CvHistoryInput, type CvLinksInput } from "../cv-out/model";
import { parseCvExtraction, type CvExtractionMap, type CvTopicKind } from "./schemas";

export const CV_CHAT_MAX_TURNS = 25;
export const CV_CHAT_MAX_WORKS = 6;
/** Con dos respuestas que no pasan el esquema, el tema se da por saltado y el temario sigue. */
export const CV_CHAT_MAX_FAILURES = 2;

export interface CvWorkDraft {
  organization: string | null;
  title: string | null;
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean;
  duties: string[];
  achievement: string | null;
}

export interface CvEducationDraft {
  institution: string;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
}

export interface CvCertificationDraft {
  issuer: string;
  title: string;
  startMonth: string | null;
}

export interface CvLanguageDraft {
  name: string;
  level: string | null;
}

export interface CvChatState {
  target: string | null;
  /** Historial ya confirmado antes del chat (`career_history`); no se vuelve a preguntar. */
  confirmed: CvHistoryInput[];
  works: CvWorkDraft[];
  workDone: boolean;
  education: CvEducationDraft[];
  certifications: CvCertificationDraft[];
  skills: string[];
  languages: CvLanguageDraft[];
  links: CvLinksInput;
  /** Claves de tema respondidas (o salteadas). */
  answered: string[];
  failures: Record<string, number>;
  /** Mensajes de la persona que ya se procesaron. */
  turns: number;
}

/** Lo que ya está confirmado en la cuenta: se siembra para no repreguntar («Actualizalo charlando»). */
export interface CvChatSeed {
  target?: string | null;
  history?: readonly CvHistoryInput[];
  skills?: readonly string[];
  languages?: readonly CvLanguageDraft[];
  links?: CvLinksInput;
}

export interface CvTopic {
  kind: CvTopicKind;
  key: string;
  /** Índice del trabajo al que se refiere el tema; null si no es de experiencia. */
  workIndex: number | null;
}

const workKey = (kind: CvTopicKind, i: number): string => `w${i}:${kind}`;
const WORK_FIELDS = ["organization", "title", "dates", "duties", "achievement"] as const;
const LIST_TOPICS = ["education", "certifications", "skills", "languages", "links"] as const;

export function initialCvChatState(seed: CvChatSeed = {}): CvChatState {
  const history = [...(seed.history ?? [])];
  const answered: string[] = [];
  if (seed.target) answered.push("target");
  const has = (k: CvHistoryInput["kind"]): boolean => history.some((h) => h.kind === k);
  if (has("educacion")) answered.push("education");
  if (has("certificacion")) answered.push("certifications");
  if ((seed.skills ?? []).length > 0) answered.push("skills");
  if ((seed.languages ?? []).length > 0) answered.push("languages");
  const l = seed.links ?? {};
  if (l.linkedin || l.github || l.portfolio) answered.push("links");
  return {
    target: seed.target ?? null,
    confirmed: history,
    works: [],
    workDone: has("trabajo"),
    education: [],
    certifications: [],
    skills: [...(seed.skills ?? [])],
    languages: [...(seed.languages ?? [])],
    links: { ...l },
    answered,
    failures: {},
    turns: 0,
  };
}

const satisfied = (s: CvChatState, key: string): boolean =>
  s.answered.includes(key) || (s.failures[key] ?? 0) >= CV_CHAT_MAX_FAILURES;

/**
 * Próximo tema pendiente, o `null` si el checklist está completo. Orden fijo: puesto objetivo, experiencia
 * (de a un trabajo: empresa, cargo, fechas, qué hacía, un logro, ¿otro?), estudios, certificaciones, skills,
 * idiomas y links.
 */
export function nextCvTopic(s: CvChatState): CvTopic | null {
  if (!satisfied(s, "target")) return { kind: "target", key: "target", workIndex: null };
  if (!s.workDone) {
    for (let i = 0; i < s.works.length; i++) {
      for (const kind of WORK_FIELDS) {
        const key = workKey(kind, i);
        if (!satisfied(s, key)) return { kind, key, workIndex: i };
      }
    }
    const i = s.works.length;
    if (i === 0) return { kind: "organization", key: workKey("organization", 0), workIndex: 0 };
    if (i < CV_CHAT_MAX_WORKS) {
      const key = `more_work:${i}`;
      if (!satisfied(s, key)) return { kind: "more_work", key, workIndex: i };
    }
  }
  for (const kind of LIST_TOPICS) {
    if (!satisfied(s, kind)) return { kind, key: kind, workIndex: null };
  }
  return null;
}

/** Temas que faltan, en orden, para mostrar el avance («3 de 7»). Cuenta secciones, no turnos. */
export function cvChecklistProgress(s: CvChatState): { done: number; total: number } {
  const next = nextCvTopic(s);
  const sections = [
    satisfied(s, "target"),
    satisfied(s, "target") && (next === null || next.workIndex === null),
    ...LIST_TOPICS.map((k) => satisfied(s, k)),
  ];
  return { done: sections.filter(Boolean).length, total: sections.length };
}

function withAnswered(s: CvChatState, key: string): CvChatState {
  return s.answered.includes(key) ? s : { ...s, answered: [...s.answered, key] };
}

function setWork(s: CvChatState, i: number, patch: Partial<CvWorkDraft>): CvChatState {
  const works = [...s.works];
  while (works.length <= i) {
    works.push({
      organization: null,
      title: null,
      startMonth: null,
      endMonth: null,
      isCurrent: false,
      duties: [],
      achievement: null,
    });
  }
  works[i] = { ...works[i]!, ...patch };
  return { ...s, works };
}

const dedupe = (items: readonly string[]): string[] => {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

function applyParsed(s: CvChatState, topic: CvTopic, d: CvExtractionMap[CvTopicKind]): CvChatState {
  const i = topic.workIndex ?? 0;
  switch (topic.kind) {
    case "target":
      return { ...s, target: (d as CvExtractionMap["target"]).target };
    case "organization": {
      const o = d as CvExtractionMap["organization"];
      if (o.noExperience || o.organization === null) {
        return s.works.length === 0 ? { ...s, workDone: true } : s;
      }
      return setWork(s, i, { organization: o.organization });
    }
    case "title":
      return setWork(s, i, { title: (d as CvExtractionMap["title"]).title });
    case "dates": {
      const x = d as CvExtractionMap["dates"];
      return setWork(s, i, {
        startMonth: x.startMonth,
        endMonth: x.endMonth,
        isCurrent: x.isCurrent,
      });
    }
    case "duties":
      return setWork(s, i, { duties: (d as CvExtractionMap["duties"]).duties });
    case "achievement":
      return setWork(s, i, { achievement: (d as CvExtractionMap["achievement"]).achievement });
    case "more_work":
      return (d as CvExtractionMap["more_work"]).more
        ? setWork(s, s.works.length, {})
        : { ...s, workDone: true };
    case "education":
      return { ...s, education: [...s.education, ...(d as CvExtractionMap["education"]).entries] };
    case "certifications":
      return {
        ...s,
        certifications: [...s.certifications, ...(d as CvExtractionMap["certifications"]).entries],
      };
    case "skills":
      return { ...s, skills: dedupe([...s.skills, ...(d as CvExtractionMap["skills"]).skills]) };
    case "languages":
      return {
        ...s,
        languages: [...s.languages, ...(d as CvExtractionMap["languages"]).languages],
      };
    case "links":
      return { ...s, links: { ...s.links, ...stripNulls(d as CvExtractionMap["links"]) } };
    default:
      return s;
  }
}

function stripNulls(l: CvExtractionMap["links"]): CvLinksInput {
  const out: CvLinksInput = {};
  if (l.linkedin) out.linkedin = l.linkedin;
  if (l.github) out.github = l.github;
  if (l.portfolio) out.portfolio = l.portfolio;
  return out;
}

/**
 * Aplica la respuesta del modelo (JSON sin confiar) al tema que se preguntó. Fuera de esquema cuenta una
 * falla: a la segunda el tema se saltea, así la conversación siempre termina. Cuenta un turno.
 */
export function applyCvAnswer(s: CvChatState, topic: CvTopic, raw: unknown): CvChatState {
  const base = { ...s, turns: s.turns + 1 };
  const parsed = parseCvExtraction(topic.kind, raw);
  if (!parsed.ok) {
    const failures = { ...base.failures, [topic.key]: (base.failures[topic.key] ?? 0) + 1 };
    const next = { ...base, failures };
    // Sin primer trabajo legible y sin más intentos: se sigue sin experiencia en vez de trabarse
    return topic.kind === "organization" &&
      failures[topic.key]! >= CV_CHAT_MAX_FAILURES &&
      s.works.length === 0
      ? { ...next, workDone: true }
      : next;
  }
  return withAnswered(applyParsed(base, topic, parsed.value), topic.key);
}

/** «No tengo» / «Saltear»: el tema queda respondido sin datos. Cuenta un turno. */
export function skipCvTopic(s: CvChatState, topic: CvTopic): CvChatState {
  const base = withAnswered({ ...s, turns: s.turns + 1 }, topic.key);
  if (topic.kind === "organization" && s.works.length === 0) return { ...base, workDone: true };
  if (topic.kind === "more_work") return { ...base, workDone: true };
  return base;
}

export type CvCloseReason = "complete" | "finish" | "turn_cap";

/** Cierre: «Terminar y armar», checklist completo o 25 turnos. */
export function cvChatCloseReason(
  s: CvChatState,
  opts: { finishRequested?: boolean } = {},
): CvCloseReason | null {
  if (opts.finishRequested) return "finish";
  if (nextCvTopic(s) === null) return "complete";
  if (s.turns >= CV_CHAT_MAX_TURNS) return "turn_cap";
  return null;
}

const trimmed = (s: string | null): string => cleanCvText(s ?? "", 120, false);

/** Trabajo completo = tiene empresa y cargo; lo demás es opcional. Los borradores sin eso se descartan. */
export function cvWorkSources(w: CvWorkDraft): string[] {
  return [w.organization, w.title, ...w.duties, w.achievement].filter(
    (x): x is string => !!x && x !== "",
  );
}

/**
 * Historial que sale del chat, con los tipos de `career_history`: lo confirmado antes más lo extraído. Las
 * viñetas son, por ahora, el texto de la persona (qué hacía y su logro); la redacción las reescribe después
 * y el verificador las compara contra `cvWorkSources`.
 */
export function cvChatHistory(s: CvChatState): CvHistoryInput[] {
  const out: CvHistoryInput[] = [...s.confirmed];
  for (const w of s.works) {
    const organization = trimmed(w.organization);
    const title = trimmed(w.title);
    if (organization === "" || title === "") continue;
    out.push({
      kind: "trabajo",
      organization,
      title,
      startMonth: w.startMonth,
      endMonth: w.isCurrent ? null : w.endMonth,
      bullets: [...w.duties, ...(w.achievement ? [w.achievement] : [])]
        .map((b) => cleanCvText(b, CV_BULLET_MAX_CHARS))
        .slice(0, CV_MAX_BULLETS),
    });
  }
  for (const e of s.education) {
    out.push({
      kind: "educacion",
      organization: e.institution,
      title: e.title,
      startMonth: e.startMonth,
      endMonth: e.endMonth,
      bullets: [],
    });
  }
  for (const c of s.certifications) {
    out.push({
      kind: "certificacion",
      organization: c.issuer,
      title: c.title,
      startMonth: c.startMonth,
      endMonth: null,
      bullets: [],
    });
  }
  return out;
}
