/**
 * Texto del flujo guiado (R33-04, C-15 a C-20): el borrador del resumen profesional y las habilidades blandas
 * propuestas por situaciones. Todo sale de las palabras de la persona: el validador rechaza una cifra, un nombre
 * o una tecnología que no estén en sus respuestas, y nada entra al CV sin que ella lo marque. Puro.
 */
import {
  CV_SUMMARY_MAX_CHARS,
  cleanCvText,
  cvRejectReasons,
  type CvRejectReason,
} from "../cv-out/verify";
import {
  CV_SOFT_SITUATIONS,
  type CvChatState,
  type CvSoftDecision,
  type CvSoftSituation,
} from "./state";

const trimEnd = (t: string): string => t.replace(/[\s.!?,;:]+$/u, "");
const upperFirst = (t: string): string =>
  t === "" ? t : t.charAt(0).toLocaleUpperCase() + t.slice(1);
const sentence = (t: string): string => `${upperFirst(trimEnd(t.trim()))}.`;

/** Palabras fijas de la plantilla del borrador: no son datos de la persona, así que el validador las admite. */
const TEMPLATE_WORDS = ["Busco un puesto de"];

/**
 * Borrador del resumen profesional (C-15 a C-17): un solo bloque de 2 o 3 frases con lo que la persona contó
 * (experiencia, puesto buscado con lo que quiere en su próximo trabajo, y lo que hace bien), sin «Objetivo»
 * aparte. Con las palabras de ella y nada más: sin respuestas, `null` (lo vacío queda vacío).
 */
export function cvSummaryDraft(s: CvChatState): string | null {
  const { experience, goal, strengths } = s.summary;
  if (!experience && !goal && !strengths) return null;
  const blocks: string[] = [];
  if (experience) blocks.push(sentence(experience));
  const wanted = [
    s.target ? `Busco un puesto de ${trimEnd(s.target.trim())}.` : null,
    goal ? sentence(goal) : null,
  ].filter((x): x is string => x !== null);
  if (wanted.length > 0) blocks.push(wanted.join(" "));
  if (strengths) blocks.push(sentence(strengths));
  // Si no entra, se sacan primero las fortalezas y después lo que busca: la experiencia es lo último que se pierde
  let text = blocks.join(" ");
  for (let drop = blocks.length - 1; text.length > CV_SUMMARY_MAX_CHARS && drop > 0; drop--) {
    text = blocks.slice(0, drop).join(" ");
  }
  const clean = cleanCvText(text, CV_SUMMARY_MAX_CHARS, false);
  return clean === "" ? null : clean;
}

/** Lo que la persona dijo y que vale como fuente del resumen. */
function summarySources(s: CvChatState): string[] {
  const works = s.works.flatMap((w) => [w.organization, w.title, ...w.duties, w.achievement]);
  const projects = s.projects.flatMap((p) => [p.name, p.role, p.description, ...p.stack]);
  const studies = [
    ...s.education.flatMap((e) => [e.institution, e.title]),
    ...s.certifications.flatMap((c) => [c.issuer, c.title]),
  ];
  return [
    s.target,
    s.summary.experience,
    s.summary.goal,
    s.summary.strengths,
    ...Object.values(s.softAnswers),
    ...works,
    ...projects,
    ...studies,
    ...s.skills,
    ...s.softSkills,
    ...s.languages.flatMap((l) => [l.name, l.level]),
    ...s.confirmed.flatMap((h) => [h.organization, h.title, ...h.bullets]),
    ...TEMPLATE_WORDS,
  ].filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

export type CvSummaryCheck = { ok: true } | { ok: false; reasons: CvRejectReason[] };

/**
 * Validador del resumen que escribe una máquina (el borrador de la IA): rechaza una cifra, un número en letras, un
 * nombre propio, una tecnología o un link que no estén en lo que la persona dijo. Lo que ella escribe a mano no
 * pasa por acá: es suyo.
 */
export function cvSummaryCheck(text: string, s: CvChatState): CvSummaryCheck {
  const reasons = cvRejectReasons(text, summarySources(s), { maxChars: CV_SUMMARY_MAX_CHARS });
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export type CvSummaryChoice = {
  text: string | null;
  origin: "model" | "answers" | "none";
};

/**
 * Elige el borrador: el de la IA solo si pasa el validador; si no, el que arma el código con las respuestas; y
 * si tampoco hay respuestas, ninguno. La IA nunca decide qué entra: pasa por acá.
 */
export function cvSummaryChoose(modelText: string | null, s: CvChatState): CvSummaryChoice {
  if (modelText && modelText.trim() !== "" && cvSummaryCheck(modelText, s).ok) {
    return { text: cleanCvText(modelText, CV_SUMMARY_MAX_CHARS, false), origin: "model" };
  }
  const draft = cvSummaryDraft(s);
  return draft ? { text: draft, origin: "answers" } : { text: null, origin: "none" };
}

/**
 * De los links del origen del CV, solo LinkedIn, GitHub y portfolio (texto no vacío). El origen del CV trae más
 * claves (`other`, R33-07) y el esquema del estado del chat es estricto: con una clave de más el servidor
 * rechazaría cada turno (`bad_request`). La semilla del chat pasa siempre por acá.
 */
export function pickCvChatLinks(links: unknown): {
  linkedin?: string;
  github?: string;
  portfolio?: string;
} {
  const src = (links && typeof links === "object" ? links : {}) as Record<string, unknown>;
  const out: { linkedin?: string; github?: string; portfolio?: string } = {};
  for (const k of ["linkedin", "github", "portfolio"] as const) {
    const v = src[k];
    if (typeof v === "string" && v !== "") out[k] = v;
  }
  return out;
}

/**
 * El resumen que va al CV: el que la persona dejó en «Esto es lo que entendí» (suyo, editado o no; si lo vació, queda
 * vacío), si no pasó por la revisión el que propuso la IA y pasó el validador, y si no el que arman las respuestas.
 * Sin nada de eso, `null`.
 */
export function cvSummaryFinal(s: CvChatState, modelSummary: string | null): string | null {
  if (s.summary.text !== null) {
    const own = cleanCvText(s.summary.text, CV_SUMMARY_MAX_CHARS, false);
    return own === "" ? null : own;
  }
  return cvSummaryChoose(modelSummary, s).text;
}

// ---------------------------------------------------------------------------
// Habilidades blandas por situaciones
// ---------------------------------------------------------------------------

/** Como máximo 4 habilidades blandas: nunca llenar el CV de adjetivos (C-20). */
export const CV_SOFT_MAX = 4;

/** Qué habilidad sugiere cada situación (C-18). Lo decide esta tabla, no un modelo. */
const SOFT_SKILLS: Record<CvSoftSituation, readonly string[]> = {
  lead: ["Liderazgo", "Comunicación"],
  problem: ["Resolución de problemas"],
  clients: ["Atención al cliente", "Trabajo en equipo"],
  organize: ["Organización", "Iniciativa"],
};

export type CvSoftProposal = {
  skill: string;
  situation: CvSoftSituation;
  /** Lo que la persona contó: es la viñeta que se propone, con sus palabras. */
  bullet: string;
  /** Empresa del trabajo más reciente, para decir «la sugerimos por lo que contaste en …»; `null` si no hay. */
  from: string | null;
};

/**
 * Las habilidades blandas que se le proponen ahora: una por cada habilidad de las situaciones que contestó, sin las
 * que ya decidió, hasta 4 contando las que ya usó. Sin ejemplo no se propone nada.
 */
export function cvSoftProposals(s: CvChatState): CvSoftProposal[] {
  const room = CV_SOFT_MAX - s.softSkills.length;
  if (room <= 0) return [];
  const from = s.works.find((w) => w.organization)?.organization ?? null;
  const out: CvSoftProposal[] = [];
  for (const situation of CV_SOFT_SITUATIONS) {
    const bullet = s.softAnswers[situation];
    if (!bullet) continue;
    for (const skill of SOFT_SKILLS[situation]) {
      if (s.softDecided[skill]) continue;
      out.push({ skill, situation, bullet, from });
    }
  }
  return out.slice(0, room);
}

/** Tareas por trabajo (tope del chat): con 4, una viñeta nueva no entra hasta reemplazar una. */
export const CV_WORK_DUTIES_MAX = 4;

/**
 * Qué pasa con la viñeta de una propuesta si la persona toca «Usarla»: `suma` (entra a la última experiencia),
 * `ya_esta` (ya figura entre las tareas), `sin_lugar` (el trabajo ya tiene 4 tareas) o `sin_trabajo` (no hay una
 * experiencia cargada). La habilidad entra igual en los cuatro casos; la pantalla lo dice antes del clic, nunca
 * se omite en silencio.
 */
export type CvSoftBulletStatus = "suma" | "ya_esta" | "sin_lugar" | "sin_trabajo";

export function cvSoftBulletStatus(s: CvChatState, proposal: CvSoftProposal): CvSoftBulletStatus {
  const first = s.works[0];
  if (!first) return "sin_trabajo";
  if (first.duties.some((d) => d.toLowerCase() === proposal.bullet.toLowerCase())) return "ya_esta";
  return first.duties.length < CV_WORK_DUTIES_MAX ? "suma" : "sin_lugar";
}

/**
 * «Usarla» o «No, gracias». Con «Usarla» la habilidad entra a las blandas y la viñeta (lo que contó) se suma una
 * sola vez a la última experiencia, si hay lugar (`cvSoftBulletStatus`). Una habilidad que no se propuso no cambia
 * nada.
 */
export function cvSoftDecide(s: CvChatState, skill: string, decision: CvSoftDecision): CvChatState {
  const proposal = cvSoftProposals(s).find((p) => p.skill === skill);
  if (!proposal) return s;
  const softDecided = { ...s.softDecided, [skill]: decision };
  if (decision === "declined") return { ...s, softDecided };
  let works = s.works;
  const first = works[0];
  if (first && cvSoftBulletStatus(s, proposal) === "suma") {
    works = [{ ...first, duties: [...first.duties, proposal.bullet] }, ...works.slice(1)];
  }
  return { ...s, softDecided, softSkills: [...s.softSkills, skill], works };
}

/** Habilidades del CV: las herramientas que dijo y las blandas que confirmó, sin repetir. */
export function cvAllSkills(s: CvChatState): string[] {
  const seen = new Set<string>();
  return [...s.skills, ...s.softSkills].filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
