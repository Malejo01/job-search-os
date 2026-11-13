/**
 * Pasos de la guía (ADR-034 §1, R10-4). Puro. De a una pregunta: puestos, modalidad, país, seniority,
 * pretensión y qué evitar. Cada respuesta del navegador es entrada no confiable: se valida con esquema
 * estricto y las palabras libres pasan por el filtro de datos sensibles y de instrucciones.
 */
import { z } from "zod";
import { detectCvInjection } from "../../cv/injection";
import { foldCvText } from "../../cv-out/verify";
import { err, ok, type Result } from "../../result";
import { isIsoCountry } from "../../countries";
import { MODALITIES } from "../../onboarding";
import { isRoleKey } from "../../skills/self-assessment";
import {
  GUIDE_STEPS,
  profileGuideAnswersSchema,
  type GuideStep,
  type ProfileGuideAnswers,
} from "../schemas";
import { screenProfileAnswer } from "../screen";
import { GUIDE_AVOID_MAX_CHARS, GUIDE_MAX_AVOID_ENTRIES, GUIDE_SENIORITY_OPTIONS } from "./copy";

export const GUIDE_MAX_ROLES = 4;

/** Una respuesta de la persona a un paso. Estricto: una clave de más falla. */
export const guideInputSchema = z.discriminatedUnion("step", [
  z.strictObject({
    step: z.literal("roles"),
    roles: z.array(z.string().refine(isRoleKey)).max(GUIDE_MAX_ROLES),
  }),
  z.strictObject({
    step: z.literal("modality"),
    modalities: z.array(z.enum(MODALITIES)).max(3),
  }),
  z.strictObject({
    step: z.literal("country"),
    country: z.string().refine(isIsoCountry),
  }),
  z.strictObject({
    step: z.literal("seniority"),
    maxYearsHard: z
      .number()
      .int()
      .nullable()
      .refine((n) => n === null || GUIDE_SENIORITY_OPTIONS.some((o) => o.years === n)),
  }),
  z.strictObject({
    step: z.literal("salary"),
    salaryFloorUsdMonthly: z.number().int().min(0).max(100_000).nullable(),
  }),
  z.strictObject({
    step: z.literal("avoid"),
    avoid: z.array(z.string().max(200)).max(40),
  }),
]);
export type GuideInput = z.infer<typeof guideInputSchema>;

export type GuideInputError =
  "invalid" | "repeated_roles" | "sensitive" | "injection" | "too_many_avoid";

const CONTROL_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]",
  "g",
);

/** Una palabra a evitar: una línea, minúsculas, sin invisibles, hasta 60 caracteres. */
function cleanAvoid(raw: string): string {
  return raw.normalize("NFC").replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Aplica la respuesta a las respuestas de la guía. Nunca lanza; devuelve el motivo, no el texto. */
export function applyGuideInput(
  answers: ProfileGuideAnswers,
  rawInput: unknown,
): Result<ProfileGuideAnswers, GuideInputError> {
  const parsed = guideInputSchema.safeParse(rawInput);
  if (!parsed.success) return err("invalid");
  const input = parsed.data;
  let next: ProfileGuideAnswers;
  switch (input.step) {
    case "roles":
      if (new Set(input.roles).size !== input.roles.length) return err("repeated_roles");
      next = { ...answers, roles: input.roles };
      break;
    case "modality":
      if (new Set(input.modalities).size !== input.modalities.length) return err("invalid");
      next = { ...answers, modalities: input.modalities };
      break;
    case "country":
      next = { ...answers, country: input.country };
      break;
    case "seniority":
      next = { ...answers, maxYearsHard: input.maxYearsHard };
      break;
    case "salary":
      next = { ...answers, salaryFloorUsdMonthly: input.salaryFloorUsdMonthly };
      break;
    case "avoid": {
      const seen = new Set<string>();
      const words: string[] = [];
      for (const raw of input.avoid) {
        const w = cleanAvoid(raw);
        if (w === "" || seen.has(foldCvText(w))) continue;
        if (w.length > GUIDE_AVOID_MAX_CHARS) return err("invalid");
        if (screenProfileAnswer(w).length > 0) return err("sensitive");
        if (detectCvInjection(w).signals.length > 0) return err("injection");
        seen.add(foldCvText(w));
        words.push(w);
      }
      if (words.length > GUIDE_MAX_AVOID_ENTRIES) return err("too_many_avoid");
      next = { ...answers, avoid: words };
      break;
    }
  }
  const checked = profileGuideAnswersSchema.safeParse(next);
  return checked.success ? ok(checked.data) : err("invalid");
}

/**
 * Las respuestas que vuelven del navegador se vuelven a filtrar (entrada no confiable): una palabra a evitar
 * con datos sensibles o con una instrucción escondida se descarta, y unos años de experiencia que no son una
 * de las opciones se borran (el paso se vuelve a preguntar). Se corre antes de usar o devolver las respuestas.
 */
export function sanitizeGuideAnswers(answers: ProfileGuideAnswers): ProfileGuideAnswers {
  const out: ProfileGuideAnswers = { ...answers };
  if (out.avoid !== undefined) {
    out.avoid = out.avoid.filter(
      (w) => screenProfileAnswer(w).length === 0 && detectCvInjection(w).signals.length === 0,
    );
  }
  if (typeof out.maxYearsHard === "number" && !isGuideSeniority(out.maxYearsHard)) {
    delete out.maxYearsHard;
  }
  return out;
}

/** ¿Estos años son una de las opciones de la guía? */
export function isGuideSeniority(years: number): boolean {
  return GUIDE_SENIORITY_OPTIONS.some((o) => o.years === years);
}

/** ¿Ya contestó este paso? `null` explícito (sin tope, sin piso) cuenta como contestado. */
export function guideStepDone(answers: ProfileGuideAnswers, step: GuideStep): boolean {
  switch (step) {
    case "roles":
      return answers.roles !== undefined;
    case "modality":
      return answers.modalities !== undefined;
    case "country":
      return answers.country !== undefined;
    case "seniority":
      return answers.maxYearsHard !== undefined;
    case "salary":
      return answers.salaryFloorUsdMonthly !== undefined;
    case "avoid":
      return answers.avoid !== undefined;
  }
}

/** El próximo paso sin contestar, o `null` si la guía terminó. */
export function nextGuideStep(answers: ProfileGuideAnswers): GuideStep | null {
  return GUIDE_STEPS.find((s) => !guideStepDone(answers, s)) ?? null;
}

/** Cuántos pasos quedan, para la barra de avance. */
export function guideStepsLeft(answers: ProfileGuideAnswers): number {
  return GUIDE_STEPS.filter((s) => !guideStepDone(answers, s)).length;
}
