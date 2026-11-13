/**
 * Esquemas del agente de perfil desde el CV (ADR-034). Estrictos (`strictObject`): una clave de más
 * (`age`, `marital_status`, `photo`, `religion`…) hace fallar el esquema. Se usan en tres lugares:
 *
 * 1. la salida que el servidor le devuelve al navegador (tarjetas),
 * 2. todo lo que vuelve del navegador (el estado de la charla, las respuestas, las tarjetas editadas:
 *    entrada no confiable, el servidor lo valida y lo vuelve a filtrar con `screenProfileCard`),
 * 3. lo que el código arma para la guía.
 *
 * Lo que el CV no dice queda `null` o `[]`, nunca inventado. Las tarjetas de lectura no llevan viñetas:
 * el CV no se resume con palabras del modelo, las viñetas las dice la persona en la etapa de huecos.
 */
import { z } from "zod";
import { hasLinkOrEmail, CV_BULLET_MAX_CHARS } from "../cv-out/verify";
import { isIsoCountry } from "../countries";
import { MODALITIES } from "../onboarding";
import { isRoleKey } from "../skills/self-assessment";

export const PROFILE_AGENT_MAX_CARDS = 60;
export const PROFILE_AGENT_FIELD_MAX_CHARS = 120;

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** Texto libre acotado, sin links ni emails (mismo filtro que la carga manual). */
// Saltos de línea, caracteres de control e invisibles: un campo de una línea no los lleva
// (se arma con RegExp para no escribirlos en el fuente)
const CONTROL_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]",
);
const line = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((t) => !CONTROL_RE.test(t), { message: "caracteres_de_control" })
    .refine((t) => !hasLinkOrEmail(t), { message: "link_o_email" });

const level123 = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const uuid = z.string().uuid();

type Dates = { startMonth: string | null; endMonth: string | null };
/** Para poner un fin hace falta un inicio, y el fin no puede ser anterior (igual que `validateHistory`). */
const datesOk = (v: Dates): boolean =>
  (v.endMonth === null || v.startMonth !== null) &&
  (v.startMonth === null || v.endMonth === null || v.endMonth >= v.startMonth);

/** Id estable de una tarjeta dentro de una lectura (`exp:0`, `edu:1`, `skill:7`, `lang:0`). */
export const profileCardIdSchema = z.string().regex(/^[a-z]{2,10}:\d{1,3}$/);

// ---------------------------------------------------------------------------
// Etapa 1 · lectura: tarjetas editables
// ---------------------------------------------------------------------------

/** Experiencia, de a un trabajo. Destino: `career_history` con `kind = 'trabajo'` y `source = 'cv'`. */
export const experienceCardSchema = z
  .strictObject({
    kind: z.literal("experience"),
    id: profileCardIdSchema,
    organization: line(PROFILE_AGENT_FIELD_MAX_CHARS),
    title: line(PROFILE_AGENT_FIELD_MAX_CHARS),
    startMonth: MONTH.nullable(),
    endMonth: MONTH.nullable(),
    isCurrent: z.boolean(),
    // Siempre vacío al leer; solo la etapa de huecos suma viñetas, con lo que dice la persona.
    bullets: z.array(line(CV_BULLET_MAX_CHARS)).max(6),
  })
  .refine(datesOk, { message: "fechas" })
  .refine((c) => !c.isCurrent || c.endMonth === null, { message: "actual_con_fin" });
export type ExperienceCard = z.infer<typeof experienceCardSchema>;

/** Estudio. Destino: `career_history` con `kind = 'educacion'` y `source = 'cv'`. */
export const educationCardSchema = z
  .strictObject({
    kind: z.literal("education"),
    id: profileCardIdSchema,
    institution: line(PROFILE_AGENT_FIELD_MAX_CHARS),
    title: line(PROFILE_AGENT_FIELD_MAX_CHARS),
    startMonth: MONTH.nullable(),
    endMonth: MONTH.nullable(),
  })
  .refine(datesOk, { message: "fechas" });
export type EducationCard = z.infer<typeof educationCardSchema>;

/**
 * Skill con nivel. Con `slug` es de la taxonomía (destino `skill_levels`); sin `slug`, es propia
 * (destino `user_skills`, 2 a 40 caracteres, máximo 30 por persona). `level` `null` = el CV no lo dice:
 * la persona lo elige en la tarjeta o la descarta. `verified` = el nombre aparece literal en el CV.
 */
export const skillCardSchema = z.strictObject({
  kind: z.literal("skill"),
  id: profileCardIdSchema,
  name: line(40, 2),
  slug: z.string().min(1).max(80).nullable(),
  level: level123.nullable(),
  verified: z.boolean(),
});
export type SkillCard = z.infer<typeof skillCardSchema>;

/**
 * Idioma. El inglés con nivel CEFR va a `profiles.english_cefr`; cualquier otro idioma viaja solo en la
 * vista previa del CV (no hay tabla de idiomas: ADR-026 §4, queda abierto para Mauro).
 */
export const languageCardSchema = z.strictObject({
  kind: z.literal("language"),
  id: profileCardIdSchema,
  name: line(40),
  level: line(30).nullable(),
});
export type LanguageCard = z.infer<typeof languageCardSchema>;

export const profileReadCardSchema = z.discriminatedUnion("kind", [
  experienceCardSchema,
  educationCardSchema,
  skillCardSchema,
  languageCardSchema,
]);
export type ProfileReadCard = z.infer<typeof profileReadCardSchema>;
export type ProfileCardKind = ProfileReadCard["kind"];

/** Lo que el servidor devuelve después de leer el CV. Nada de esto se guardó todavía. */
export const profileReadProposalSchema = z.strictObject({
  cards: z.array(profileReadCardSchema).max(PROFILE_AGENT_MAX_CARDS),
  /** Puestos sugeridos por el modelo, validados contra `ROLE_KEYS`: alimentan la guía, no el perfil. */
  suggestedRoles: z.array(z.string().refine(isRoleKey)).max(2),
  /** Cuántas propuestas descartó el código (datos sensibles, inyección, fechas inválidas). */
  dropped: z.number().int().min(0).max(999),
});
export type ProfileReadProposal = z.infer<typeof profileReadProposalSchema>;

/** Decisión de la persona sobre una tarjeta; `card` es la versión editada (se vuelve a validar y filtrar). */
export const profileCardDecisionSchema = z.strictObject({
  id: profileCardIdSchema,
  decision: z.enum(["accept", "discard"]),
  card: profileReadCardSchema.optional(),
});
export type ProfileCardDecision = z.infer<typeof profileCardDecisionSchema>;

// ---------------------------------------------------------------------------
// Etapa 2 · huecos
// ---------------------------------------------------------------------------

export const GAP_TOPICS = ["achievement", "duties", "dates", "skill_level"] as const;
export type GapTopic = (typeof GAP_TOPICS)[number];

/** `<historyId|skill:slug>:<tema>`: lo arma el código; el navegador solo lo devuelve. */
export const gapKeySchema = z
  .string()
  .max(80)
  .regex(/^[A-Za-z0-9:_-]+$/);

/** La pregunta la redacta una plantilla del código (por carrera), no el modelo. Una por vez. */
export const profileGapQuestionSchema = z.strictObject({
  key: gapKeySchema,
  topic: z.enum(GAP_TOPICS),
  question: z.string().min(1).max(300),
  /** Repreguntas ya hechas sobre este tema (0, 1 o 2). */
  followUp: z.number().int().min(0).max(2),
  /** Cuántos temas quedan, para la barra de avance. */
  remaining: z.number().int().min(0).max(40),
});
export type ProfileGapQuestion = z.infer<typeof profileGapQuestionSchema>;

/** Respuesta de la persona. «No tengo» es una respuesta válida y cierra el tema sin repreguntar. */
export const profileGapAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    key: gapKeySchema,
    text: z.string().trim().min(1).max(1000),
  }),
  z.strictObject({ kind: z.literal("none"), key: gapKeySchema }),
  z.strictObject({ kind: z.literal("level"), key: gapKeySchema, level: level123 }),
]);
export type ProfileGapAnswer = z.infer<typeof profileGapAnswerSchema>;

/**
 * Tarjeta a confirmar que sale de una respuesta: cambia algo del perfil, y solo se aplica con el clic.
 * Apunta por `historyId` a una fila de `career_history` ya aceptada (el servidor la lee con RLS, la
 * charla no guarda copias).
 */
export const profileGapCardSchema = z.discriminatedUnion("field", [
  z.strictObject({
    field: z.literal("achievement"),
    key: gapKeySchema,
    historyId: uuid,
    bullet: line(CV_BULLET_MAX_CHARS),
  }),
  z.strictObject({
    field: z.literal("duties"),
    key: gapKeySchema,
    historyId: uuid,
    bullets: z.array(line(CV_BULLET_MAX_CHARS)).min(1).max(4),
  }),
  z
    .strictObject({
      field: z.literal("dates"),
      key: gapKeySchema,
      historyId: uuid,
      startMonth: MONTH.nullable(),
      endMonth: MONTH.nullable(),
      isCurrent: z.boolean(),
    })
    .refine(datesOk, { message: "fechas" })
    .refine((c) => !c.isCurrent || c.endMonth === null, { message: "actual_con_fin" }),
  z.strictObject({
    field: z.literal("skill_level"),
    key: gapKeySchema,
    name: line(40, 2),
    slug: z.string().min(1).max(80).nullable(),
    level: level123,
  }),
]);
export type ProfileGapCard = z.infer<typeof profileGapCardSchema>;

/** Estado de la etapa de huecos que viaja en cada request. El servidor no confía en él para los topes. */
export const profileGapStateSchema = z.strictObject({
  /** Temas cerrados (respondidos, salteados o con «no tengo»). */
  answered: z.array(gapKeySchema).max(80),
  followUps: z.record(gapKeySchema, z.number().int().min(0).max(2)),
  current: gapKeySchema.nullable(),
});
export type ProfileGapState = z.infer<typeof profileGapStateSchema>;

// ---------------------------------------------------------------------------
// Etapa 3 · guía de búsqueda (sin modelo: opciones y datos)
// ---------------------------------------------------------------------------

export const GUIDE_STEPS = [
  "roles",
  "modality",
  "country",
  "seniority",
  "salary",
  "avoid",
] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];

const roleKey = z.string().refine(isRoleKey, { message: "puesto_desconocido" });

/** Respuestas de la guía, de a una. Todo opcional hasta que la persona llega a ese paso. */
export const profileGuideAnswersSchema = z.strictObject({
  roles: z.array(roleKey).max(4).optional(),
  modalities: z.array(z.enum(MODALITIES)).max(3).optional(),
  country: z.string().refine(isIsoCountry, { message: "pais" }).optional(),
  /** «Seniority» se guarda como años máximos (`max_years_hard`), el único campo que existe en los criterios. */
  maxYearsHard: z.number().int().min(0).max(40).nullable().optional(),
  /** Pretensión mínima en USD por mes (`salary_floor_usd_monthly`); `null` = sin piso. */
  salaryFloorUsdMonthly: z.number().int().min(0).max(100_000).nullable().optional(),
  /** Qué evitar: palabras que se suman a `title_blocklist` (60 caracteres, 10 como máximo). */
  avoid: z.array(line(60)).max(10).optional(),
});
export type ProfileGuideAnswers = z.infer<typeof profileGuideAnswersSchema>;

export const ALERT_PORTAL_IDS = ["linkedin", "indeed", "getonboard"] as const;

/**
 * Tarjetas de la guía. Son datos, sin texto libre del modelo: el copy de cada tarjeta es fijo y vive en
 * código, y nunca promete trabajo, entrevistas ni sueldos.
 */
export const profileGuideCardSchema = z.discriminatedUnion("kind", [
  /** Puestos objetivo → `profiles.target_roles` (validados con `parseTargetRoles` y el límite del plan). */
  z.strictObject({ kind: z.literal("roles"), roles: z.array(roleKey).min(1).max(4) }),
  /** Criterios → mismas validaciones que `/settings/criteria` y el perfil. Solo lo que la persona eligió. */
  z.strictObject({
    kind: z.literal("criteria"),
    modalities: z.array(z.enum(MODALITIES)).max(3).nullable(),
    country: z.string().refine(isIsoCountry, { message: "pais" }).nullable(),
    maxYearsHard: z.number().int().min(0).max(40).nullable(),
    salaryFloorUsdMonthly: z.number().int().min(0).max(100_000).nullable(),
    titleBlocklistAdd: z.array(line(60)).max(10),
  }),
  /** Palabras para crear la alerta en un portal (`alerts/portal-guide.ts`), con el link a la guía de reenvío. */
  z.strictObject({
    kind: z.literal("alert_keywords"),
    portal: z.enum(ALERT_PORTAL_IDS),
    language: z.enum(["es", "en", "both"]),
    keywords: z.array(line(60)).min(1).max(8),
  }),
  /**
   * Skill a reforzar (va al plan). Sale de datos: `evidence` es obligatoria, así que no existe una
   * tarjeta de este tipo sin ofertas del pool de su carrera que la pidan. No la opina el modelo.
   */
  z.strictObject({
    kind: z.literal("reinforce"),
    slug: z.string().min(1).max(80),
    name: line(40, 2),
    evidence: z.strictObject({
      offersAsking: z.number().int().min(1),
      poolSize: z.number().int().min(1),
    }),
  }),
]);
export type ProfileGuideCard = z.infer<typeof profileGuideCardSchema>;

// ---------------------------------------------------------------------------
// Estado que viaja en cada request
// ---------------------------------------------------------------------------

export const PROFILE_AGENT_STAGES = ["read", "gaps", "guide", "write"] as const;
export type ProfileAgentStageName = (typeof PROFILE_AGENT_STAGES)[number];

/**
 * Estado del agente en el navegador. La charla no se guarda: lo confirmado vive en las tablas del perfil,
 * y esto es solo el hilo. `stage` es para pintar la pantalla: el servidor no le cree (decide por lo que
 * hay en la base y por `llm_calls`).
 */
export const profileAgentStateSchema = z.strictObject({
  stage: z.enum(PROFILE_AGENT_STAGES),
  gaps: profileGapStateSchema,
  guide: profileGuideAnswersSchema,
});
export type ProfileAgentState = z.infer<typeof profileAgentStateSchema>;

export function initialProfileAgentState(): ProfileAgentState {
  return { stage: "read", gaps: { answered: [], followUps: {}, current: null }, guide: {} };
}

/** Estado validado, o `null` si no cumple el esquema. */
export function parseProfileAgentState(raw: unknown): ProfileAgentState | null {
  const parsed = profileAgentStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
