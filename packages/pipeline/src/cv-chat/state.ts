/**
 * Estado y temario del chat de CV (C-25). El temario lo decide este checklist determinista a partir de lo
 * confirmado y lo extraído hasta ahora; el modelo solo formula la pregunta del tema y extrae la respuesta.
 * Todo es inmutable y puro: cada función devuelve un estado nuevo.
 */
import { cleanCvText, CV_BULLET_MAX_CHARS } from "../cv-out/verify";
import { CV_MAX_BULLETS, type CvHistoryInput, type CvLinksInput } from "../cv-out/model";
import type { CvConflict } from "./conflicts";
import { parseCvExtraction, type CvExtractionMap, type CvTopicKind } from "./schemas";
export const CV_CHAT_MAX_TURNS = 25;
/**
 * Rol de un proyecto cuando la persona no lo dijo (R12-2): `career_history` exige un rol y no se inventa
 * uno; «Proyecto» no afirma nada que la persona no haya contado.
 */
export const CV_PROJECT_DEFAULT_ROLE = "Proyecto";
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

/**
 * Proyecto dicho en la charla (R12-2), en cualquier tema. Sale como entrada `proyecto` de `career_history`
 * (R12-4): `name` es el nombre, `role` el rol si lo dijo, la descripción y el stack van como viñetas.
 */
export interface CvProjectDraft {
  name: string;
  role: string | null;
  description: string | null;
  stack: string[];
  /** Solo https y copiado del mensaje de la persona (`usableCvExtras`). */
  link: string | null;
}

export interface CvLanguageDraft {
  name: string;
  level: string | null;
}

/** Situaciones por las que se preguntan las habilidades blandas (R33-04, C-18): nunca «¿cuáles son tus habilidades blandas?». */
export const CV_SOFT_SITUATIONS = ["lead", "problem", "clients", "organize"] as const;
export type CvSoftSituation = (typeof CV_SOFT_SITUATIONS)[number];
export type CvSoftDecision = "used" | "declined";

/**
 * Lo que la persona contó para el «Resumen profesional» (R33-04, C-15 a C-17). Son sus palabras limpias;
 * `text` es el borrador editable de 2 o 3 frases (lo arma el código con estas respuestas y la persona lo corrige).
 */
export interface CvSummaryAnswers {
  experience: string | null;
  goal: string | null;
  strengths: string | null;
  text: string | null;
}

export const emptySummary = (): CvSummaryAnswers => ({
  experience: null,
  goal: null,
  strengths: null,
  text: null,
});

export interface CvChatState {
  /**
   * Flujo guiado de la R33 (resumen profesional y situaciones para las habilidades blandas, `guided: true`).
   * Un estado sin la marca (de un navegador con la versión anterior) sigue con el temario anterior.
   */
  guided: boolean;
  /** Claves de tema salteadas con «Saltear esta pregunta» (R33-03): se pueden volver a abrir. */
  skipped: string[];
  summary: CvSummaryAnswers;
  /** Respuestas a las situaciones (R33-04): lo que la persona contó, tal cual (limpio). */
  softAnswers: Partial<Record<CvSoftSituation, string>>;
  /** Habilidades blandas propuestas que la persona ya decidió («Usarla» / «No, gracias»), por nombre. */
  softDecided: Record<string, CvSoftDecision>;
  /** Habilidades blandas que la persona confirmó con «Usarla»: entran a las habilidades del CV. */
  softSkills: string[];
  target: string | null;
  /** Historial ya confirmado antes del chat (`career_history`); no se vuelve a preguntar. */
  confirmed: CvHistoryInput[];
  works: CvWorkDraft[];
  workDone: boolean;
  /** Proyectos que contó en cualquier tema (R12-2). No tienen tema propio en el checklist. */
  projects: CvProjectDraft[];
  education: CvEducationDraft[];
  certifications: CvCertificationDraft[];
  skills: string[];
  languages: CvLanguageDraft[];
  links: CvLinksInput;
  /** Claves de tema respondidas (o salteadas). */
  answered: string[];
  failures: Record<string, number>;
  /** Repreguntas ya hechas por clave de tema (R4-16); el tope lo fija `CV_FOLLOWUP_MAX`. */
  followUps: Record<string, number>;
  /** Repregunta vigente (redactada por el modelo y validada por el código), si el tema se repite. */
  followUp: { key: string; question: string } | null;
  /**
   * Contradicción pendiente (R12-3): lo dicho choca con lo anterior o con lo confirmado. Mientras está, la
   * pregunta es «¿Cuál dejo?» y la respuesta la resuelve el código (`resolveCvConflict`), sin modelo.
   */
  conflict: CvConflict | null;
  /** Mensajes de la persona que ya se procesaron. */
  turns: number;
}

/** Lo que ya está confirmado en la cuenta: se siembra para no repreguntar («Actualizalo charlando»). */
export interface CvChatSeed {
  /** Arranca el flujo guiado de la R33 (resumen y situaciones). Sin esto, el temario anterior. */
  guided?: boolean;
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
/** Flujo guiado (R33-04): tres preguntas del resumen después del puesto y cuatro situaciones de habilidades blandas. */
export const CV_SUMMARY_TOPICS = [
  "summary_experience",
  "summary_goal",
  "summary_strengths",
] as const;
export const CV_SOFT_TOPICS = [
  "soft_lead",
  "soft_problem",
  "soft_clients",
  "soft_organize",
] as const;
const SUMMARY_TOPICS = CV_SUMMARY_TOPICS;
const SOFT_TOPICS = CV_SOFT_TOPICS;

/**
 * Puesto con el que arranca el chat (R11-12): el titular del perfil si lo hay; si no, el nombre de la
 * carrera que la persona ya eligió. Con alguno de los dos no se le vuelve a preguntar el puesto.
 */
export function chatTarget(
  headline: string | null | undefined,
  roleLabel: string | null | undefined,
): string | null {
  const h = (headline ?? "").replace(/\s+/g, " ").trim();
  if (h) return h.slice(0, 120);
  const r = (roleLabel ?? "").trim();
  return r ? r.slice(0, 120) : null;
}

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
    guided: seed.guided ?? false,
    skipped: [],
    summary: emptySummary(),
    softAnswers: {},
    softDecided: {},
    softSkills: [],
    target: seed.target ?? null,
    confirmed: history,
    works: [],
    workDone: has("trabajo"),
    projects: [],
    education: [],
    certifications: [],
    skills: [...(seed.skills ?? [])],
    languages: [...(seed.languages ?? [])],
    links: { ...l },
    answered,
    failures: {},
    followUps: {},
    followUp: null,
    conflict: null,
    turns: 0,
  };
}

const satisfied = (s: CvChatState, key: string): boolean =>
  s.answered.includes(key) || (s.failures[key] ?? 0) >= CV_CHAT_MAX_FAILURES;

/** ¿Este tema ya está respondido (o se dio por saltado tras dos respuestas ilegibles)? */
export const cvTopicSatisfied = satisfied;

/**
 * Próximo tema pendiente, o `null` si el checklist está completo. Orden fijo: puesto objetivo, experiencia
 * (de a un trabajo: empresa, cargo, fechas, qué hacía, un logro, ¿otro?), estudios, certificaciones, skills,
 * idiomas y links.
 */
export function nextCvTopic(s: CvChatState): CvTopic | null {
  if (!satisfied(s, "target")) return { kind: "target", key: "target", workIndex: null };
  if (s.guided) {
    for (const kind of SUMMARY_TOPICS) {
      if (!satisfied(s, kind)) return { kind, key: kind, workIndex: null };
    }
  }
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
  for (const kind of listTopics(s)) {
    if (!satisfied(s, kind)) return { kind, key: kind, workIndex: null };
  }
  return null;
}

/** Temas de lista en orden. En el flujo guiado, las situaciones de habilidades blandas van después de las herramientas. */
function listTopics(s: CvChatState): readonly CvTopicKind[] {
  if (!s.guided) return LIST_TOPICS;
  return ["education", "certifications", "skills", ...SOFT_TOPICS, "languages", "links"];
}

/**
 * Temas que faltan, en orden, para mostrar el avance («3 de 7»). Cuenta secciones, no turnos. Son siempre 7: puesto,
 * resumen, experiencia, estudios, habilidades, idiomas y links (el flujo anterior no tenía el resumen y contaba
 * estudios y certificaciones por separado).
 */
export function cvChecklistProgress(s: CvChatState): { done: number; total: number } {
  const next = nextCvTopic(s);
  const workDone = satisfied(s, "target") && (next === null || next.workIndex === null);
  const sections = s.guided
    ? [
        satisfied(s, "target"),
        SUMMARY_TOPICS.every((k) => satisfied(s, k)),
        workDone && SUMMARY_TOPICS.every((k) => satisfied(s, k)),
        satisfied(s, "education") && satisfied(s, "certifications"),
        satisfied(s, "skills") && SOFT_TOPICS.every((k) => satisfied(s, k)),
        satisfied(s, "languages"),
        satisfied(s, "links"),
      ]
    : [satisfied(s, "target"), workDone, ...LIST_TOPICS.map((k) => satisfied(s, k))];
  return { done: sections.filter(Boolean).length, total: sections.length };
}

/**
 * Número que se muestra en «Avance: N de M temas» (R11-12): nunca 0. El chat arranca con el puesto
 * que ya está en el perfil, así que el primer tema ya está resuelto y el contador empieza en 1.
 */
export const cvProgressShown = (done: number): number => Math.max(1, done);

/** Clave de un tema de experiencia (`w0:title`), la misma que usa el checklist. */
export const cvWorkKey = workKey;

export function withAnswered(s: CvChatState, key: string): CvChatState {
  return s.answered.includes(key) ? s : { ...s, answered: [...s.answered, key] };
}

export function setWork(s: CvChatState, i: number, patch: Partial<CvWorkDraft>): CvChatState {
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

export const dedupe = (items: readonly string[]): string[] => {
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
  // Respuesta a una repregunta (R4-16): se suma a lo ya extraído, no lo pisa con vacíos
  const again = (s.followUps[topic.key] ?? 0) > 0;
  const prev = s.works[i];
  if (again && prev) {
    if (topic.kind === "dates") {
      const x = d as CvExtractionMap["dates"];
      const isCurrent = x.isCurrent || prev.isCurrent;
      const startMonth = x.startMonth ?? prev.startMonth;
      let endMonth = isCurrent ? null : (x.endMonth ?? prev.endMonth);
      if (startMonth && endMonth && endMonth < startMonth) endMonth = null;
      return setWork(s, i, { startMonth, endMonth, isCurrent });
    }
    if (topic.kind === "duties") {
      const x = d as CvExtractionMap["duties"];
      return setWork(s, i, { duties: dedupe([...prev.duties, ...x.duties]).slice(0, 4) });
    }
    if (topic.kind === "achievement") {
      const x = d as CvExtractionMap["achievement"];
      return setWork(s, i, { achievement: x.achievement ?? prev.achievement });
    }
  }
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
    case "summary_experience":
    case "summary_goal":
    case "summary_strengths": {
      const field = topic.kind.slice("summary_".length) as "experience" | "goal" | "strengths";
      const { answer } = d as CvExtractionMap["summary_goal"];
      return { ...s, summary: { ...s.summary, [field]: answer, text: null } };
    }
    case "soft_lead":
    case "soft_problem":
    case "soft_clients":
    case "soft_organize": {
      const situation = topic.kind.slice("soft_".length) as CvSoftSituation;
      const { answer } = d as CvExtractionMap["soft_lead"];
      const softAnswers = { ...s.softAnswers };
      if (answer === null) delete softAnswers[situation];
      else softAnswers[situation] = answer;
      return { ...s, softAnswers };
    }
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
  const applied = withAnswered(applyParsed(base, topic, parsed.value), topic.key);
  // Contestarla saca la pregunta de las salteadas (R33-03)
  return applied.skipped.includes(topic.key)
    ? { ...applied, skipped: applied.skipped.filter((k) => k !== topic.key) }
    : applied;
}

/** «No tengo» / «Saltear»: el tema queda respondido sin datos. Cuenta un turno. */
export function skipCvTopic(s: CvChatState, topic: CvTopic): CvChatState {
  // Con una contradicción pendiente (R12-3), «Saltear» la descarta: queda lo que ya estaba
  if (s.conflict) return { ...s, conflict: null, turns: s.turns + 1 };
  // Saltear un tema también descarta la repregunta pendiente (R4-16)
  const skipped = s.skipped.includes(topic.key) ? s.skipped : [...s.skipped, topic.key];
  const base = withAnswered({ ...s, turns: s.turns + 1, followUp: null, skipped }, topic.key);
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
  for (const p of s.projects) {
    const name = trimmed(p.name);
    if (name === "") continue;
    out.push({
      kind: "proyecto",
      organization: name,
      title: trimmed(p.role) || CV_PROJECT_DEFAULT_ROLE,
      startMonth: null,
      endMonth: null,
      bullets: [p.description, p.stack.length > 0 ? `Stack: ${p.stack.join(", ")}` : null]
        .filter((b): b is string => !!b)
        .map((b) => cleanCvText(b, CV_BULLET_MAX_CHARS))
        .filter((b) => b !== ""),
      link: p.link,
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
