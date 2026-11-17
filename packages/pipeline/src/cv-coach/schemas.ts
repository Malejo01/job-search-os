/**
 * Esquemas del coach de CV (ADR-038 §3). Estrictos: una clave de más hace fallar el esquema. Se usan en:
 *
 * 1. la salida del modelo (`cv_review`, `cv_coach_turn`): JSON sin confiar, se valida acá y después el
 *    código vuelve a revisar referencias, grounding y datos sensibles (falla cerrado: lo que no pasa se
 *    descarta entero);
 * 2. lo que viaja por el navegador (la lista firmada, el avance y la foto «antes»): entrada no confiable,
 *    el servidor la valida y verifica la firma;
 * 3. lo que el servidor le devuelve al navegador.
 *
 * Nombres de campo en inglés; tipos de problema en español (ADR-038). La lista de problemas no tiene texto
 * libre del modelo: el diagnóstico que ve la persona lo arma el código con plantillas por tipo.
 */
import { z } from "zod";
import { MONTH, name, sentence, text } from "../cv-chat/schemas";
import { CV_BULLET_MAX_CHARS } from "../cv-out/verify";
import { projectLinkSchema } from "../profile-agent/schemas";
import {
  CV_COACH_MAX_ISSUES,
  CV_ISSUE_SEVERITIES,
  CV_ISSUE_TYPES,
  CV_REVIEW_MAX_PROPOSED,
} from "./issues";
import { CV_COACH_MAX_TURNS } from "./limits";

const SAFE_ID = /^[A-Za-z0-9:_-]+$/;

export const CV_COACH_SECTIONS = [
  "experience",
  "projects",
  "education",
  "skills",
  "summary",
] as const;
export type CvCoachSection = (typeof CV_COACH_SECTIONS)[number];

export const CV_COACH_FIELDS = [
  "title",
  "organization",
  "dates",
  "bullets",
  "link",
  "stack",
  "level",
  "order",
] as const;
export type CvCoachField = (typeof CV_COACH_FIELDS)[number];

/**
 * A qué apunta un problema: sección, ítem (id de `career_history` o `slug` de la taxonomía; `null` para la
 * sección entera, por ejemplo el resumen) y campo (`null` = el ítem entero).
 */
export const cvItemRefSchema = z.strictObject({
  section: z.enum(CV_COACH_SECTIONS),
  itemId: z.string().min(1).max(80).regex(SAFE_ID).nullable(),
  field: z.enum(CV_COACH_FIELDS).nullable(),
});
export type CvItemRef = z.infer<typeof cvItemRefSchema>;

const skillSlug = z.string().min(1).max(60).regex(SAFE_ID);

// ---------------------------------------------------------------------------
// cv_review: lo que devuelve el modelo
// ---------------------------------------------------------------------------

export const cvReviewProposedIssueSchema = z.strictObject({
  type: z.enum(CV_ISSUE_TYPES),
  ref: cvItemRefSchema,
  /** Cita literal del CV. R12-8 la conserva solo si es substring normalizado del ítem; si no, `null`. */
  quote: z.string().max(200).nullable(),
  /** Skill de la taxonomía (`brecha_con_puesto`, `skill_pedida_sin_evidencia`); se valida contra `skills`. */
  skillSlug: skillSlug.nullable(),
  severity: z.enum(CV_ISSUE_SEVERITIES),
});
export type CvReviewProposedIssue = z.infer<typeof cvReviewProposedIssueSchema>;

/** Salida de `cv_review`. */
export const cvReviewOutputSchema = z.strictObject({
  issues: z.array(cvReviewProposedIssueSchema).max(CV_REVIEW_MAX_PROPOSED),
});
export type CvReviewOutput = z.infer<typeof cvReviewOutputSchema>;

// ---------------------------------------------------------------------------
// Diagnóstico ya validado por el código
// ---------------------------------------------------------------------------

/** `iss:<n>`: lo arma el código al ordenar; el navegador solo lo devuelve. */
export const cvIssueIdSchema = z.string().regex(/^iss:\d{1,2}$/);

/**
 * Problema validado, ordenado y recortado (R12-8). `source`: `model` si lo propuso `cv_review` y pasó la
 * validación, `data` si lo calculó el código con la demanda del pool. Sin texto libre del modelo.
 */
export const cvIssueSchema = z.strictObject({
  id: cvIssueIdSchema,
  type: z.enum(CV_ISSUE_TYPES),
  ref: cvItemRefSchema,
  quote: z.string().max(200).nullable(),
  skillSlug: skillSlug.nullable(),
  severity: z.enum(CV_ISSUE_SEVERITIES),
  source: z.enum(["model", "data"]),
});
export type CvIssue = z.infer<typeof cvIssueSchema>;

/**
 * Lista firmada que viaja por el navegador (ADR-038 §8). La firma (HMAC con la subclave
 * `cvcoach-issues-v1` de `AUTH_SECRET`) cubre `flowId`, `userId` implícito, `expiresAt` e `issues` en JSON
 * canónico; la calcula y verifica el adaptador (R12-8). Vence a las 2 h, como el ticket del agente.
 */
export const cvCoachSignedIssuesSchema = z.strictObject({
  v: z.literal(1),
  flowId: z.string().regex(/^[0-9a-f]{12}$/),
  /** Epoch en segundos. */
  expiresAt: z.number().int().positive(),
  /** Puesto objetivo con el que se hizo el diagnóstico (del perfil). */
  target: name,
  issues: z.array(cvIssueSchema).max(CV_COACH_MAX_ISSUES),
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type CvCoachSignedIssues = z.infer<typeof cvCoachSignedIssuesSchema>;

// ---------------------------------------------------------------------------
// cv_coach_turn: lo que devuelve el modelo
// ---------------------------------------------------------------------------

/** Link de proyecto dicho en la charla: mismas reglas que en la tarjeta. */
const link = projectLinkSchema;

/** Cambios al ítem en foco. Todo opcional: lo que la persona no dijo queda `null` o `[]`. */
export const cvCoachPatchSchema = z.strictObject({
  title: name.nullable(),
  organization: name.nullable(),
  startMonth: MONTH.nullable(),
  endMonth: MONTH.nullable(),
  isCurrent: z.boolean().nullable(),
  bullets: z.array(sentence).max(4),
  link: link.nullable(),
  stack: z.array(text(60)).max(12),
});
export type CvCoachPatch = z.infer<typeof cvCoachPatchSchema>;

export const CV_COACH_EXTRA_KINDS = [
  "proyecto",
  "trabajo",
  "logro",
  "fecha",
  "herramienta",
  "estudio",
] as const;

/** Lo dicho fuera del foco: en vez de descartarse, se propone como tarjeta o saltea temas ya respondidos. */
export const cvCoachExtraSchema = z.strictObject({
  kind: z.enum(CV_COACH_EXTRA_KINDS),
  text: sentence,
  ref: cvItemRefSchema.nullable(),
});
export type CvCoachExtra = z.infer<typeof cvCoachExtraSchema>;

/**
 * Salida de `cv_coach_turn` (una sola llamada por turno). El modelo NO dice qué problema resolvió: lo decide
 * el código por tipo. `nextQuestion` es un borrador: pasa el validador de R12-9 o cae a la plantilla.
 */
export const cvCoachTurnOutputSchema = z.strictObject({
  patch: cvCoachPatchSchema,
  extras: z.array(cvCoachExtraSchema).max(6),
  /** «No tengo» / «no sé» / «prefiero no». */
  declined: z.boolean(),
  nextQuestion: z.string().max(300).nullable(),
});
export type CvCoachTurnOutput = z.infer<typeof cvCoachTurnOutputSchema>;

// ---------------------------------------------------------------------------
// Lo que viaja por el navegador
// ---------------------------------------------------------------------------

export const CV_COACH_STAGES = ["diagnosis", "chat", "done"] as const;

/**
 * Avance de la charla (`sessionStorage`, `jso:coach:state`). No tiene dónde llevar el texto del CV ni los
 * mensajes: un test lo fija. Los turnos y el gasto NO viajan acá: salen de `llm_calls` por `label`.
 * `stage` es solo para pintar; el servidor no le cree.
 */
export const cvCoachStateSchema = z.strictObject({
  stage: z.enum(CV_COACH_STAGES),
  /** Problema en foco. */
  current: cvIssueIdSchema.nullable(),
  resolved: z.array(cvIssueIdSchema).max(CV_COACH_MAX_ISSUES),
  /** «No tengo», salteados o con dos respuestas ilegibles. */
  skipped: z.array(cvIssueIdSchema).max(CV_COACH_MAX_ISSUES),
  /** Repreguntas ya hechas sobre el problema en foco (0 a 2). */
  followUps: z.number().int().min(0).max(2),
  /** Respuestas ilegibles sobre el problema en foco (0 a 2). */
  failures: z.number().int().min(0).max(2),
  /** Turnos que el navegador cree que van; solo para la barra de avance. */
  turnsShown: z.number().int().min(0).max(CV_COACH_MAX_TURNS),
});
export type CvCoachState = z.infer<typeof cvCoachStateSchema>;

/**
 * Foto «antes» para «Qué mejoró» (`jso:coach:before`, ADR-038 §8): las filas confirmadas de
 * `career_history` al empezar el coach, leídas con RLS. Si se pierde, la vista muestra solo los problemas.
 */
export const cvCoachBeforeItemSchema = z.strictObject({
  historyId: z.string().uuid(),
  kind: z.enum(["trabajo", "educacion", "certificacion", "proyecto"]),
  organization: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  bullets: z.array(z.string().max(CV_BULLET_MAX_CHARS)).max(6),
});
export const cvCoachBeforeSchema = z.strictObject({
  flowId: z.string().regex(/^[0-9a-f]{12}$/),
  items: z.array(cvCoachBeforeItemSchema).max(40),
});
export type CvCoachBefore = z.infer<typeof cvCoachBeforeSchema>;

/** Respuesta de la persona en un turno: texto libre, «no tengo» o elegir una de dos opciones. */
export const cvCoachAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    issueId: cvIssueIdSchema,
    text: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({ kind: z.literal("none"), issueId: cvIssueIdSchema }),
  z.strictObject({
    kind: z.literal("choice"),
    issueId: cvIssueIdSchema,
    choice: z.union([z.literal(0), z.literal(1)]),
  }),
  /** «Ya está, armalo». */
  z.strictObject({ kind: z.literal("finish") }),
]);
export type CvCoachAnswer = z.infer<typeof cvCoachAnswerSchema>;
