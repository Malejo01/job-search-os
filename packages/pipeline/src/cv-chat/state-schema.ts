/**
 * Validación del estado del chat de CV cuando vuelve del navegador (C-25). La conversación no se guarda:
 * el estado viaja en cada request, así que el servidor lo trata como entrada no confiable. Estricto y
 * acotado (largos y cantidades); `turns` no se confía, lo fija el ticket firmado del servidor.
 */
import { z } from "zod";
import { CV_PROJECT_LINK_MAX_CHARS, cvProjectLink } from "../cv-out/model";
import type { CvChatState } from "./state";

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const str = (max: number) => z.string().max(max);
const name = (max: number) => z.string().min(1).max(max);
const url = z
  .string()
  .max(200)
  .regex(/^https?:\/\/\S+$/i)
  .nullable()
  .optional();

const work = z.strictObject({
  organization: str(120).nullable(),
  title: str(120).nullable(),
  startMonth: MONTH.nullable(),
  endMonth: MONTH.nullable(),
  isCurrent: z.boolean(),
  duties: z.array(name(220)).max(4),
  achievement: str(220).nullable(),
});

// Link de un proyecto (R12-4): la misma regla que la carga manual y el CHECK de la base.
const projectLink = z
  .string()
  .max(CV_PROJECT_LINK_MAX_CHARS)
  .refine((v) => cvProjectLink(v) === v)
  .nullable()
  .optional();

const confirmed = z
  .strictObject({
    kind: z.enum(["trabajo", "educacion", "certificacion", "proyecto"]),
    organization: name(120),
    title: name(120),
    startMonth: MONTH.nullable(),
    endMonth: MONTH.nullable(),
    bullets: z.array(name(220)).max(6),
    link: projectLink,
  })
  .refine((e) => e.kind === "proyecto" || e.link == null);

// Proyectos dichos en la charla (R12-2): mismos topes que una entrada del historial
const project = z.strictObject({
  // Puede quedar vacío mientras la persona lo corrige: `cvChatHistory` saltea los proyectos sin nombre
  name: str(120),
  role: str(120).nullable(),
  description: str(220).nullable(),
  stack: z.array(name(40)).max(8),
  link: z
    .string()
    .max(CV_PROJECT_LINK_MAX_CHARS)
    .refine((v) => cvProjectLink(v) === v)
    .nullable(),
});

// Contradicción pendiente (R12-3)
const conflict = z
  .strictObject({
    workIndex: z.number().int().min(0).max(5),
    field: z.enum(["title", "startMonth", "endMonth"]),
    previous: name(120),
    proposed: name(120),
    source: z.enum(["said", "confirmed"]),
  })
  .refine(
    (c) =>
      c.field === "title" ||
      (MONTH.safeParse(c.previous).success && MONTH.safeParse(c.proposed).success),
  );

export const CV_CHAT_STATE_SCHEMA = z.strictObject({
  target: str(120).nullable(),
  confirmed: z.array(confirmed).max(20),
  works: z.array(work).max(6),
  workDone: z.boolean(),
  // R12-2: opcional para aceptar el estado de un navegador con la versión anterior de la página
  projects: z.array(project).max(6).default([]),
  education: z
    .array(
      z.strictObject({
        institution: name(120),
        title: name(120),
        startMonth: MONTH.nullable(),
        endMonth: MONTH.nullable(),
      }),
    )
    .max(5),
  certifications: z
    .array(z.strictObject({ issuer: name(120), title: name(120), startMonth: MONTH.nullable() }))
    .max(8),
  skills: z.array(name(60)).max(40),
  languages: z.array(z.strictObject({ name: name(40), level: str(30).nullable() })).max(6),
  links: z.strictObject({ linkedin: url, github: url, portfolio: url }),
  answered: z.array(name(40)).max(80),
  failures: z.record(name(40), z.number().int().min(0).max(5)),
  // R4-16: opcionales para aceptar el estado de un navegador con la versión anterior de la página
  followUps: z.record(name(40), z.number().int().min(0).max(5)).default({}),
  followUp: z
    .strictObject({ key: name(40), question: name(300) })
    .nullable()
    .default(null),
  // R12-3: opcional para aceptar el estado de un navegador con la versión anterior de la página
  conflict: conflict.nullable().default(null),
  turns: z.number().int().min(0).max(25),
});

/** Estado del navegador validado, o `null` si no cumple el esquema. */
export function parseCvChatState(raw: unknown): CvChatState | null {
  const parsed = CV_CHAT_STATE_SCHEMA.safeParse(raw);
  return parsed.success ? (parsed.data as CvChatState) : null;
}
