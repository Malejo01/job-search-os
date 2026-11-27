import { BETA_LAUNCH_ROLE_KEYS, isRoleKey, type RoleKey } from "./skills/self-assessment";

/**
 * La carrera en el alta (R32-01). Puro: sin I/O ni reloj. La carrera es obligatoria: una de las ocho de la
 * beta (o cualquiera del catálogo en el onboarding) o «Otra» con texto libre. El texto de «Otra» es un dato de
 * la persona que se muestra tal cual (React lo escapa) y **nunca entra a un prompt**: por eso la validación
 * es de forma (largo y caracteres), no de contenido. «Otra» no abre ninguna carrera por sí sola (R32-03).
 */

/** Valor del campo de elección cuando la persona eligió «Otra». No es una clave de carrera. */
export const CAREER_OTHER_VALUE = "otra";
export const CAREER_OTHER_MIN = 2;
export const CAREER_OTHER_MAX = 60;

export type CareerOtherParse =
  { ok: true; value: string } | { ok: false; reason: "corta" | "larga" | "caracteres" };

// Letras (con tilde), números, espacios y signos de puntuación comunes. Sin marcas de HTML, enlaces ni control.
const SAFE_TEXT = /^[\p{L}\p{M}\p{N} .,;:'’()/&+\-–]+$/u;
const LOOKS_LIKE_LINK = /(https?:|www\.|\w\.(com|net|org|ar)\b)/i;

/** Valida el texto libre de «Otra»: recorta, junta espacios y exige entre 2 y 60 caracteres seguros. */
export function parseCareerOther(raw: unknown): CareerOtherParse {
  if (typeof raw !== "string") return { ok: false, reason: "corta" };
  // El salto de línea o el tabulador no son parte de un nombre de carrera: se rechazan antes de juntar espacios
  if (/[\p{Cc}\p{Cf}]/u.test(raw)) return { ok: false, reason: "caracteres" };
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < CAREER_OTHER_MIN) return { ok: false, reason: "corta" };
  if (value.length > CAREER_OTHER_MAX) return { ok: false, reason: "larga" };
  if (!SAFE_TEXT.test(value) || LOOKS_LIKE_LINK.test(value)) {
    return { ok: false, reason: "caracteres" };
  }
  return { ok: true, value };
}

export type CareerChoiceParse =
  | { ok: true; roles: RoleKey[]; other: string | null }
  | { ok: false; field: "career" }
  | { ok: false; field: "careerOther"; reason: "corta" | "larga" | "caracteres" };

/**
 * La elección del recuadro que se le muestra a una cuenta vieja sin carrera: una de las ocho de la beta o
 * «Otra» con su texto. Con una carrera de la beta el texto de «Otra» se descarta.
 */
export function parseCareerChoice(input: { career: unknown; other: unknown }): CareerChoiceParse {
  const career = typeof input.career === "string" ? input.career : "";
  if (career === CAREER_OTHER_VALUE) {
    const other = parseCareerOther(input.other);
    if (!other.ok) return { ok: false, field: "careerOther", reason: other.reason };
    return { ok: true, roles: [], other: other.value };
  }
  if (isRoleKey(career) && BETA_LAUNCH_ROLE_KEYS.includes(career)) {
    return { ok: true, roles: [career], other: null };
  }
  return { ok: false, field: "career" };
}

export type CareerPromptFacts = {
  /** `profiles.target_roles` tal como está guardado (puede traer claves que ya no existen). */
  targetRoles: readonly string[];
  careerOther: string | null;
  /** Cuándo se le pidió la carrera. Cualquier valor no nulo cuenta: se pide una sola vez. */
  askedAt: Date | string | null;
};

/**
 * ¿Hay que pedirle la carrera a esta cuenta ahora? Solo si no tiene ninguna (ni «Otra») y nunca se le pidió.
 * Sin datos del perfil (`null`: la consulta falló o la columna todavía no existe) no se pide: falla cerrado.
 */
export function needsCareerPrompt(facts: CareerPromptFacts | null): boolean {
  if (!facts) return false;
  if (facts.askedAt) return false;
  if (facts.careerOther && facts.careerOther.trim() !== "") return false;
  return !facts.targetRoles.some((r) => isRoleKey(r));
}
