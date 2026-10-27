/**
 * Esquemas estrictos de extracción del chat de CV (C-25). El modelo devuelve JSON por tema; todo lo que no
 * cumple el esquema exacto (campos de más, largos, fechas, links) se descarta: falla cerrado y el tema se
 * vuelve a preguntar o se saltea. Los textos salen limpios (sin links, emails ni invisibles).
 */
import { z } from "zod";
import { err, ok, type Result } from "../result";
import { cleanCvText, CV_BULLET_MAX_CHARS } from "../cv-out/verify";

export const CV_CHAT_TOPIC_KINDS = [
  "target",
  "organization",
  "title",
  "dates",
  "duties",
  "achievement",
  "more_work",
  "education",
  "certifications",
  "skills",
  "languages",
  "links",
] as const;
export type CvTopicKind = (typeof CV_CHAT_TOPIC_KINDS)[number];

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Texto libre de la persona: tope de largo antes de limpiar, no vacío después. */
const text = (max: number, capitalize = false) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => cleanCvText(s, max, capitalize))
    .refine((s) => s.length > 0);

const sentence = text(CV_BULLET_MAX_CHARS, true);
const name = text(120);
const url = z
  .string()
  .max(200)
  .regex(/^https?:\/\/\S+$/i);

const dateEntry = {
  startMonth: MONTH.nullable(),
  endMonth: MONTH.nullable(),
};

const orderedDates = (v: { startMonth: string | null; endMonth: string | null }): boolean =>
  v.startMonth === null || v.endMonth === null || v.endMonth >= v.startMonth;

export const CV_EXTRACTION_SCHEMAS = {
  target: z.strictObject({ target: name }),
  organization: z.strictObject({
    organization: name.nullable(),
    noExperience: z.boolean(),
  }),
  title: z.strictObject({ title: name }),
  dates: z
    .strictObject({ ...dateEntry, isCurrent: z.boolean() })
    .refine(orderedDates)
    .refine((v) => !v.isCurrent || v.endMonth === null),
  duties: z.strictObject({ duties: z.array(sentence).min(1).max(4) }),
  achievement: z.strictObject({ achievement: sentence.nullable() }),
  more_work: z.strictObject({ more: z.boolean() }),
  education: z.strictObject({
    entries: z
      .array(z.strictObject({ institution: name, title: name, ...dateEntry }).refine(orderedDates))
      .max(5),
  }),
  certifications: z.strictObject({
    entries: z
      .array(z.strictObject({ issuer: name, title: name, startMonth: MONTH.nullable() }))
      .max(8),
  }),
  skills: z.strictObject({ skills: z.array(text(60)).max(40) }),
  languages: z.strictObject({
    languages: z.array(z.strictObject({ name: text(40), level: text(30).nullable() })).max(6),
  }),
  links: z.strictObject({
    linkedin: url.nullable(),
    github: url.nullable(),
    portfolio: url.nullable(),
  }),
} as const;

export type CvExtractionMap = {
  [K in CvTopicKind]: z.infer<(typeof CV_EXTRACTION_SCHEMAS)[K]>;
};

/** Valida lo que devolvió el modelo para un tema. Nunca lanza; fuera de esquema es `err("schema")`. */
export function parseCvExtraction<K extends CvTopicKind>(
  kind: K,
  raw: unknown,
): Result<CvExtractionMap[K], "schema"> {
  const parsed = CV_EXTRACTION_SCHEMAS[kind].safeParse(raw);
  return parsed.success ? ok(parsed.data as CvExtractionMap[K]) : err("schema");
}
