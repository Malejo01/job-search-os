/**
 * Plantillas de respaldo de las preguntas del coach de CV (ADR-038 §2). Puro: no lee archivos. El adaptador
 * lee `packages/prompts/cv_coach_fallbacks.v1.md` y le pasa el texto a `parseCoachFallbacks`; acá solo se
 * definen el tipo, el formato y la validación (mismo patrón que `profile-agent/gaps/templates.ts`).
 *
 * Se usan cuando la pregunta que redactó el modelo no pasa el validador (`question.ts`) y en la primera
 * pregunta de la charla, que no tiene llamada al modelo.
 *
 * Formato del markdown (después del frontmatter):
 *
 *   ## <tipo de problema>          uno por cada `CV_ISSUE_TYPES`
 *   ### <variante>                 organizacion | proyecto | habilidad | puesto
 *   - pregunta: texto
 *   - repregunta: texto
 *
 * La variante sale del ancla del problema: un trabajo o un estudio (`organizacion`), un proyecto
 * (`proyecto`), una skill (`habilidad`) o la sección entera (`puesto`). Cada tipo tiene que tener la
 * variante `puesto`, que es la que se usa cuando falta la del ancla. Cualquier otra línea con contenido es
 * un error (no se descarta en silencio).
 *
 * Cada texto: una sola línea, entre 10 y 220 caracteres, con «?», sin dígitos, sin links, sin datos
 * sensibles ni preguntas sobre ellos, sin instrucciones escondidas. Lleva el marcador de su variante
 * (así siempre nombra el problema) y, además, puede llevar `{puesto}`.
 */
import { detectCvInjection } from "../../cv/injection";
import { SENSITIVE_QUESTION_RE } from "../../cv-chat/follow-up";
import { foldCvText, hasLinkOrEmail } from "../../cv-out/verify";
import { findProfileSensitive } from "../../profile-agent/sensitive";
import { err, ok, type Result } from "../../result";
import { CV_ISSUE_TYPES, type CvIssueType } from "../issues";

export const COACH_FALLBACK_VARIANTS = ["organizacion", "proyecto", "habilidad", "puesto"] as const;
export type CoachFallbackVariant = (typeof COACH_FALLBACK_VARIANTS)[number];

export const COACH_TEMPLATE_MIN_CHARS = 10;
export const COACH_TEMPLATE_MAX_CHARS = 220;
/** Largo máximo de la pregunta ya con los marcadores reemplazados. */
export const COACH_QUESTION_MAX_CHARS = 300;

/** Largo con el que entra cada dato en la pregunta (se recorta): así las plantillas tienen margen. */
export const COACH_MARKER_MAX_CHARS: Record<CoachFallbackVariant, number> = {
  organizacion: 60,
  proyecto: 60,
  habilidad: 40,
  puesto: 60,
};

/** Lo que dice la pregunta si el dato falta (nunca queda un marcador sin reemplazar). */
const MARKER_DEFAULTS: Record<CoachFallbackVariant, string> = {
  organizacion: "ese trabajo",
  proyecto: "ese proyecto",
  habilidad: "esa habilidad",
  puesto: "el puesto que buscás",
};

export type CoachFallbackEntry = { question: string; followUp: string };
export type CoachFallbackSet = Partial<Record<CoachFallbackVariant, CoachFallbackEntry>> & {
  puesto: CoachFallbackEntry;
};
export type CoachFallbacks = Record<CvIssueType, CoachFallbackSet>;

export type CoachFallbackError = {
  code:
    | "linea_desconocida"
    | "tipo_desconocido"
    | "tipo_repetido"
    | "variante_desconocida"
    | "variante_repetida"
    | "falta_tipo"
    | "falta_variante_puesto"
    | "falta_pregunta"
    | "falta_repregunta"
    | "texto_invalido";
  /** Tipo y variante donde falló (nunca el texto). */
  type: string | null;
  variant: string | null;
  /** Para `texto_invalido`: el motivo. */
  reason?: string;
  line?: number;
};

/**
 * Palabras de datos sensibles que una pregunta no nombra: la lista de `SENSITIVE_QUESTION_RE` más contacto y
 * documento (sobre texto plegado). Es amplia a propósito: ante la duda, la pregunta no se usa.
 */
const EXTRA_FORBIDDEN_RE =
  /\bdni\b|domicilio|direccion|telefono|celular|\bpasaporte\b|\bcuil\b|\bcuit\b/;

/** ¿El texto toca datos sensibles? Lo usan las plantillas y el validador de las preguntas del modelo. */
export function coachQuestionIsSensitive(text: string): boolean {
  const folded = foldCvText(text);
  return (
    SENSITIVE_QUESTION_RE.test(folded) ||
    EXTRA_FORBIDDEN_RE.test(folded) ||
    findProfileSensitive(text).length > 0
  );
}

/** Por qué un texto de plantilla no sirve, o `null` si sirve. */
export function coachFallbackTextProblem(
  text: string,
  variant: CoachFallbackVariant,
): string | null {
  if (text.length < COACH_TEMPLATE_MIN_CHARS) return "muy_corto";
  if (text.length > COACH_TEMPLATE_MAX_CHARS) return "muy_largo";
  if (!text.includes("?")) return "sin_signo_de_pregunta";
  if (/\d/.test(text)) return "con_digitos";
  if (hasLinkOrEmail(text)) return "con_link_o_email";
  if (coachQuestionIsSensitive(text)) return "dato_sensible";
  if (detectCvInjection(text).signals.length > 0) return "instruccion";
  const holders = [...text.matchAll(/\{[^{}]*\}|[{}]/g)].map((m) => m[0]);
  const own = `{${variant}}`;
  if (holders.some((h) => h !== own && h !== "{puesto}")) return "marcador_no_admitido";
  if (!holders.includes(own)) return "sin_marcador";
  // peor caso con los marcadores reemplazados
  let worst = text.length;
  for (const h of holders) {
    const key = h.slice(1, -1) as CoachFallbackVariant;
    worst += COACH_MARKER_MAX_CHARS[key] - h.length;
  }
  if (worst > COACH_QUESTION_MAX_CHARS) return "muy_largo_con_marcador";
  return null;
}

const TYPE_RE = /^##\s+([a-z_]+)\s*$/;
const VARIANT_RE = /^###\s+([a-z_]+)\s*$/;
const QUESTION_RE = /^[-*]\s*pregunta\s*:\s*(.+)$/;
const FOLLOW_UP_RE = /^[-*]\s*repregunta\s*:\s*(.+)$/;

/** Parsea y valida el cuerpo del markdown (sin el frontmatter). Nunca lanza. */
export function parseCoachFallbacks(body: string): Result<CoachFallbacks, CoachFallbackError> {
  const draft = new Map<
    string,
    Map<CoachFallbackVariant, { question?: string; followUp?: string }>
  >();
  let type: string | null = null;
  let variant: CoachFallbackVariant | null = null;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    const line = i + 1;
    if (raw === "" || raw.startsWith("<!--") || raw.startsWith(">") || /^#\s/.test(raw)) continue;
    const t = TYPE_RE.exec(raw);
    if (t) {
      const name = t[1]!;
      if (!(CV_ISSUE_TYPES as readonly string[]).includes(name)) {
        return err({ code: "tipo_desconocido", type: name, variant: null, line });
      }
      if (draft.has(name)) return err({ code: "tipo_repetido", type: name, variant: null, line });
      type = name;
      variant = null;
      draft.set(name, new Map());
      continue;
    }
    const v = VARIANT_RE.exec(raw);
    if (v) {
      const name = v[1]!;
      if (type === null || !(COACH_FALLBACK_VARIANTS as readonly string[]).includes(name)) {
        return err({ code: "variante_desconocida", type, variant: name, line });
      }
      variant = name as CoachFallbackVariant;
      const variants = draft.get(type)!;
      if (variants.has(variant)) return err({ code: "variante_repetida", type, variant, line });
      variants.set(variant, {});
      continue;
    }
    const q = QUESTION_RE.exec(raw);
    const f = FOLLOW_UP_RE.exec(raw);
    if ((q || f) && type !== null && variant !== null) {
      const entry = draft.get(type)!.get(variant)!;
      const key = q ? "question" : "followUp";
      if (entry[key] !== undefined) return err({ code: "variante_repetida", type, variant, line });
      entry[key] = (q ?? f)![1]!.trim();
      continue;
    }
    return err({ code: "linea_desconocida", type, variant, line });
  }

  const out = {} as CoachFallbacks;
  for (const key of CV_ISSUE_TYPES) {
    const variants = draft.get(key);
    if (!variants) return err({ code: "falta_tipo", type: key, variant: null });
    if (!variants.has("puesto")) {
      return err({ code: "falta_variante_puesto", type: key, variant: null });
    }
    const set: Partial<Record<CoachFallbackVariant, CoachFallbackEntry>> = {};
    for (const [name, e] of variants) {
      if (e.question === undefined)
        return err({ code: "falta_pregunta", type: key, variant: name });
      if (e.followUp === undefined) {
        return err({ code: "falta_repregunta", type: key, variant: name });
      }
      for (const text of [e.question, e.followUp]) {
        const reason = coachFallbackTextProblem(text, name);
        if (reason) return err({ code: "texto_invalido", type: key, variant: name, reason });
      }
      set[name] = { question: e.question, followUp: e.followUp };
    }
    out[key] = set as CoachFallbackSet;
  }
  return ok(out);
}

/** Dato de una sola línea, recortado al largo de su marcador. */
export function coachMarkerValue(variant: CoachFallbackVariant, value: string | null | undefined) {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  // Lo que va entre paréntesis («Software contable (Tango, Bejerman, SAP)») es detalle: si el nombre no
  // entra entero, se corta antes del paréntesis y no a mitad de él
  const max = COACH_MARKER_MAX_CHARS[variant];
  const base = flat.length > max ? flat.replace(/\s*\(.*$/, "").trim() || flat : flat;
  const one = base.slice(0, max).trim();
  return one || MARKER_DEFAULTS[variant];
}

/**
 * Pregunta de respaldo lista para mostrar: la variante del ancla (o `puesto`) con los marcadores
 * reemplazados. Nunca pasa por el modelo.
 */
export function renderCoachFallback(
  fallbacks: CoachFallbacks,
  type: CvIssueType,
  anchor: { variant: CoachFallbackVariant; value: string | null },
  followUp: boolean,
  target: string | null,
): string {
  const set = fallbacks[type];
  const entry = set[anchor.variant] ?? set.puesto;
  const variant = set[anchor.variant] ? anchor.variant : "puesto";
  const text = followUp ? entry.followUp : entry.question;
  const own = coachMarkerValue(variant, variant === "puesto" ? target : anchor.value);
  const puesto = coachMarkerValue("puesto", target);
  return (
    text
      // función de reemplazo: con una cadena, `$&` y `$'` del nombre se interpretarían
      .replaceAll(`{${variant}}`, () => own)
      .replaceAll("{puesto}", () => puesto)
      .slice(0, COACH_QUESTION_MAX_CHARS)
  );
}
