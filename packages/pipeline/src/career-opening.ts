import {
  BETA_LAUNCH_ROLE_KEYS,
  isRoleKey,
  ROLE_KEYS,
  type RoleKey,
} from "./skills/self-assessment";
import { CAREER_OTHER_VALUE } from "./career-choice";

/**
 * Apertura por carrera (R32-03). Puro: sin I/O ni reloj. La lista de carreras abiertas vive en la base y la cambia
 * un admin; acá solo se decide qué significa para una persona.
 *
 * - **Nada abre solo.** El panel de cobertura informa y el responsable decide; esta regla no mira cobertura.
 * - **Con la lista vacía no se cierra nada a quien ya está adentro.** Una cuenta anterior (`existingAccount`) entra
 *   siempre, esté su carrera abierta, cerrada, vacía o sea «Otra». Solo el alta nueva depende de la lista.
 * - **El alta nueva de una carrera cerrada va a la lista de espera de su carrera** y ve el aviso de «todavía
 *   estamos sumando ofertas de …». Con la lista vacía, toda alta nueva espera.
 * - **«Otra» nunca abre sola:** no es una carrera del catálogo, así que no se puede abrir ni aparece abierta aunque
 *   la lista la traiga. Una clave inventada o una lista rota tampoco abren nada (falla cerrado).
 */

export const CAREER_OPENING_ACTIONS = ["abrir", "cerrar"] as const;
export type CareerOpeningAction = (typeof CAREER_OPENING_ACTIONS)[number];

/** ¿Es una carrera del catálogo que se puede abrir? «Otra», lo vacío y lo inventado, no. */
export function isOpenableCareer(value: unknown): value is RoleKey {
  return typeof value === "string" && value !== CAREER_OTHER_VALUE && isRoleKey(value);
}

/** La lista de la base, ya limpia: solo claves abribles, sin repetir, en el orden del catálogo. Lo roto, vacío. */
export function parseOpenCareers(raw: unknown): RoleKey[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter(isOpenableCareer));
  return ROLE_KEYS.filter((key) => wanted.has(key));
}

export type CareerAccess =
  /** Alta nueva de una carrera abierta. */
  | { access: "abierta" }
  /** Alta nueva que espera: su carrera no abrió, es «Otra» o no tiene carrera. `career` es la clave, si hay. */
  | {
      access: "lista_de_espera";
      reason: "cerrada" | "otra" | "sin_carrera";
      career: RoleKey | null;
    }
  /** Cuenta anterior: no pierde nada. */
  | { access: "dentro" };

export function careerAccess(input: {
  career: string | null | undefined;
  openCareers: readonly string[] | null | undefined;
  /** La cuenta ya existía antes de que se mirara la lista. */
  existingAccount: boolean;
}): CareerAccess {
  if (input.existingAccount) return { access: "dentro" };
  if (input.career === CAREER_OTHER_VALUE) {
    return { access: "lista_de_espera", reason: "otra", career: null };
  }
  if (!isOpenableCareer(input.career)) {
    return { access: "lista_de_espera", reason: "sin_carrera", career: null };
  }
  const open = parseOpenCareers(input.openCareers);
  return open.includes(input.career)
    ? { access: "abierta" }
    : { access: "lista_de_espera", reason: "cerrada", career: input.career };
}

export type CareerOpeningRow = { career: RoleKey; open: boolean };

/**
 * Las filas del panel: las ocho carreras de la beta, en su orden, con su estado, y después cualquier otra que esté
 * abierta (para poder cerrarla). Las demás carreras del catálogo no se listan: abrirlas es una decisión aparte.
 */
export function summarizeCareerOpening(openCareers: readonly string[]): CareerOpeningRow[] {
  const open = new Set(parseOpenCareers(openCareers));
  const beta: CareerOpeningRow[] = BETA_LAUNCH_ROLE_KEYS.map((career) => ({
    career,
    open: open.has(career),
  }));
  const extra: CareerOpeningRow[] = ROLE_KEYS.filter(
    (k) => open.has(k) && !BETA_LAUNCH_ROLE_KEYS.includes(k),
  ).map((career) => ({ career, open: true }));
  return [...beta, ...extra];
}
