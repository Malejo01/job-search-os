/**
 * Plantillas de las preguntas de huecos (ADR-034 §1). Puro: no lee archivos. El adaptador lee
 * `packages/prompts/profile_gaps.v1.md` y le pasa el texto a `parseGapTemplates`; acá solo se define el
 * tipo, el formato y la validación. Las preguntas NO las redacta el modelo: salen de este archivo, tal
 * cual, y `cv_interview` solo extrae lo que la persona contestó.
 *
 * Formato del markdown (después del frontmatter):
 *
 *   ## <carrera | default>
 *   ### <tema>                 achievement | duties | dates | skill_level
 *   - pregunta: texto
 *   - repregunta: texto        obligatoria salvo en skill_level (el nivel se elige con botones)
 *
 * Cualquier otra línea con contenido es un error (no se descarta en silencio). Hace falta una sección por
 * carrera de la beta (`BETA_LAUNCH_ROLE_KEYS`) y una `default`, que cubre a quien no tiene carrera de la beta.
 *
 * Cada texto: una sola línea, hasta 220 caracteres, con «?», sin dígitos (no se inventan números), sin links,
 * sin datos sensibles ni preguntas sobre ellos, sin instrucciones escondidas. Solo admite los marcadores
 * `{organizacion}` (temas de trabajo) y `{habilidad}` (`skill_level`), que el código reemplaza.
 */
import { detectCvInjection } from "../../cv/injection";
import { foldCvText, hasLinkOrEmail } from "../../cv-out/verify";
import { err, ok, type Result } from "../../result";
import { BETA_LAUNCH_ROLE_KEYS } from "../../skills/self-assessment";
import { GAP_TOPICS, type GapTopic } from "../schemas";
import { findProfileSensitive } from "../sensitive";

export const GAP_DEFAULT_CAREER = "default";
export const GAP_TEMPLATE_CAREERS: readonly string[] = [
  ...BETA_LAUNCH_ROLE_KEYS,
  GAP_DEFAULT_CAREER,
];
export type GapCareerKey = string;

export const GAP_TEMPLATE_MAX_CHARS = 220;
/** Largo máximo de la pregunta ya con los marcadores reemplazados (`profileGapQuestionSchema`). */
export const GAP_QUESTION_MAX_CHARS = 300;
/** El nombre de la empresa se recorta en la pregunta (la fila guarda hasta 120); así las plantillas tienen margen. */
const ORGANIZATION_MAX_CHARS = 60;
const SKILL_MAX_CHARS = 40;

export type GapTemplateEntry = { question: string; followUp: string | null };
export type GapTemplates = Record<GapCareerKey, Record<GapTopic, GapTemplateEntry>>;

export type GapTemplateError = {
  code:
    | "linea_desconocida"
    | "seccion_repetida"
    | "tema_repetido"
    | "tema_desconocido"
    | "falta_seccion"
    | "falta_tema"
    | "falta_pregunta"
    | "falta_repregunta"
    | "repregunta_no_admitida"
    | "texto_invalido";
  /** Carrera y tema donde falló (nunca el texto). */
  career: string | null;
  topic: string | null;
  /** Para `texto_invalido`: el motivo. */
  reason?: string;
  line?: number;
};

/** Palabras sobre datos sensibles: ni se preguntan ni se nombran (lista amplia, sobre texto plegado). */
const FORBIDDEN_QUESTION_RE =
  /estado civil|casad[oa]|solter[oa]|divorciad[oa]|viud[oa]|\bhij[oa]s?\b|religi|afiliad[oa]|afiliaci|sindic|orientacion sexual|embaraz|fecha de nacimiento|\bnaci[oó]\b|\bedad\b|\bsalud\b|enferm|discapacid|politic|sexual|nacionalidad|\bdni\b|domicilio|direccion|telefono|celular/;

/** Por qué un texto de plantilla no sirve, o `null` si sirve. */
export function gapTemplateTextProblem(text: string, topic: GapTopic): string | null {
  if (text.length < 10) return "muy_corto";
  if (text.length > GAP_TEMPLATE_MAX_CHARS) return "muy_largo";
  if (!text.includes("?")) return "sin_signo_de_pregunta";
  if (/\d/.test(text)) return "con_digitos";
  if (hasLinkOrEmail(text)) return "con_link_o_email";
  const folded = foldCvText(text);
  if (FORBIDDEN_QUESTION_RE.test(folded) || findProfileSensitive(text).length > 0) {
    return "dato_sensible";
  }
  if (detectCvInjection(text).signals.length > 0) return "instruccion";
  const holders = [...text.matchAll(/\{[^{}]*\}|[{}]/g)].map((m) => m[0]);
  const allowed = topic === "skill_level" ? "{habilidad}" : "{organizacion}";
  if (holders.some((h) => h !== allowed)) return "marcador_no_admitido";
  // peor caso con el marcador reemplazado
  const worst =
    text.length +
    holders.length *
      ((topic === "skill_level" ? SKILL_MAX_CHARS : ORGANIZATION_MAX_CHARS) - allowed.length);
  if (worst > GAP_QUESTION_MAX_CHARS) return "muy_largo_con_marcador";
  return null;
}

const SECTION_RE = /^##\s+([a-z0-9_]+)\s*$/;
const TOPIC_RE = /^###\s+([a-z_]+)\s*$/;
const QUESTION_RE = /^[-*]\s*pregunta\s*:\s*(.+)$/;
const FOLLOW_UP_RE = /^[-*]\s*repregunta\s*:\s*(.+)$/;

/** Parsea y valida el cuerpo del markdown (sin el frontmatter). Nunca lanza. */
export function parseGapTemplates(body: string): Result<GapTemplates, GapTemplateError> {
  const draft = new Map<string, Map<GapTopic, { question?: string; followUp?: string }>>();
  let career: string | null = null;
  let topic: GapTopic | null = null;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    const line = i + 1;
    if (raw === "" || raw.startsWith("<!--") || raw.startsWith(">") || /^#\s/.test(raw)) continue;
    const sec = SECTION_RE.exec(raw);
    if (sec) {
      career = sec[1]!;
      topic = null;
      if (draft.has(career)) return err({ code: "seccion_repetida", career, topic: null, line });
      draft.set(career, new Map());
      continue;
    }
    const top = TOPIC_RE.exec(raw);
    if (top) {
      const name = top[1]!;
      if (career === null || !(GAP_TOPICS as readonly string[]).includes(name)) {
        return err({ code: "tema_desconocido", career, topic: null, line });
      }
      topic = name as GapTopic;
      const topics = draft.get(career)!;
      if (topics.has(topic)) return err({ code: "tema_repetido", career, topic, line });
      topics.set(topic, {});
      continue;
    }
    const q = QUESTION_RE.exec(raw);
    const f = FOLLOW_UP_RE.exec(raw);
    if ((q || f) && career !== null && topic !== null) {
      const entry = draft.get(career)!.get(topic)!;
      const key = q ? "question" : "followUp";
      if (entry[key] !== undefined) return err({ code: "tema_repetido", career, topic, line });
      entry[key] = (q ?? f)![1]!.trim();
      continue;
    }
    return err({ code: "linea_desconocida", career, topic, line });
  }

  const out: GapTemplates = {};
  for (const key of GAP_TEMPLATE_CAREERS) {
    const topics = draft.get(key);
    if (!topics) return err({ code: "falta_seccion", career: key, topic: null });
    const entries = {} as Record<GapTopic, GapTemplateEntry>;
    for (const t of GAP_TOPICS) {
      const e = topics.get(t);
      if (!e) return err({ code: "falta_tema", career: key, topic: t });
      if (e.question === undefined) return err({ code: "falta_pregunta", career: key, topic: t });
      if (t === "skill_level") {
        if (e.followUp !== undefined) {
          return err({ code: "repregunta_no_admitida", career: key, topic: t });
        }
      } else if (e.followUp === undefined) {
        return err({ code: "falta_repregunta", career: key, topic: t });
      }
      for (const text of [e.question, e.followUp]) {
        if (text === undefined) continue;
        const reason = gapTemplateTextProblem(text, t);
        if (reason) return err({ code: "texto_invalido", career: key, topic: t, reason });
      }
      entries[t] = { question: e.question, followUp: e.followUp ?? null };
    }
    out[key] = entries;
  }
  return ok(out);
}

/** La carrera de la beta de la persona (la primera de sus puestos), o `default`. */
export function gapCareerKey(targetRoles: readonly string[]): GapCareerKey {
  for (const r of targetRoles) {
    if ((BETA_LAUNCH_ROLE_KEYS as readonly string[]).includes(r)) return r;
  }
  return GAP_DEFAULT_CAREER;
}

/**
 * Pregunta lista para mostrar: la plantilla de la carrera (o `default`) con los marcadores reemplazados por
 * los datos de la persona, recortados a una línea. Nunca pasa por el modelo.
 */
export function renderGapQuestion(
  templates: GapTemplates,
  career: GapCareerKey,
  topic: GapTopic,
  followUp: boolean,
  ctx: { organization?: string | null; skill?: string | null },
): string {
  const entry = (templates[career] ?? templates[GAP_DEFAULT_CAREER])![topic];
  const text = followUp && entry.followUp !== null ? entry.followUp : entry.question;
  const oneLine = (v: string | null | undefined, max: number): string =>
    (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const org = oneLine(ctx.organization, ORGANIZATION_MAX_CHARS) || "ese trabajo";
  const skill = oneLine(ctx.skill, SKILL_MAX_CHARS) || "esa habilidad";
  return text
    .replaceAll("{organizacion}", org)
    .replaceAll("{habilidad}", skill)
    .slice(0, GAP_QUESTION_MAX_CHARS);
}
