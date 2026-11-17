import {
  CV_COACH_STORAGE_KEYS,
  PROFILE_AGENT_STORAGE_KEYS,
  cvCoachBeforeSchema,
  cvCoachSignedIssuesSchema,
  cvCoachStateSchema,
  type CvCoachBefore,
  type CvCoachSignedIssues,
  type CvCoachState,
} from "@job-search-os/pipeline";
import { useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * Lo que el coach guarda en el navegador (ADR-038 §8): `sessionStorage` por pestaña, nunca `localStorage`.
 * Todo se valida al leer (entrada no confiable) y cualquier error de acceso cuenta como «no hay»: la página
 * vuelve al diagnóstico o a la lectura. Solo para componentes de cliente.
 *
 * Además de las tres claves del contrato, los textos de plantilla del diagnóstico (`VIEWS_KEY`) se guardan al
 * lado de la lista firmada para no volver a pedir el diagnóstico al recargar (cada pedido cuenta en el tope
 * de dos por charla). Son textos del código con el ancla del ítem: nada del modelo.
 */
export const CV_COACH_VIEWS_KEY = `${CV_COACH_STORAGE_KEYS.issues}:vista`;

export const cvCoachViewSchema = z.strictObject({
  id: z.string().regex(/^iss:\d{1,2}$/),
  type: z.string().max(40),
  severity: z.enum(["alta", "media", "baja"]),
  title: z.string().max(400),
  hint: z.string().max(400),
  anchor: z.string().max(300),
  quote: z.string().max(200).nullable(),
});
export type CvCoachViewData = z.infer<typeof cvCoachViewSchema>;
const viewsSchema = z.strictObject({
  heading: z.string().max(300),
  views: z.array(cvCoachViewSchema).max(10),
});
export type CvCoachViewsData = z.infer<typeof viewsSchema>;

function read(key: string): unknown {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sin almacenamiento la charla sigue en memoria; al recargar vuelve al diagnóstico
  }
}

export function readProfileTicket(): string | null {
  try {
    return window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.ticket);
  } catch {
    return null;
  }
}

export function writeProfileTicket(ticket: string): void {
  try {
    window.sessionStorage.setItem(PROFILE_AGENT_STORAGE_KEYS.ticket, ticket);
  } catch {
    // ídem
  }
}

const parse = <T>(schema: z.ZodType<T>, v: unknown): T | null => {
  const p = schema.safeParse(v);
  return p.success ? p.data : null;
};

export const readIssues = (): CvCoachSignedIssues | null =>
  parse(cvCoachSignedIssuesSchema, read(CV_COACH_STORAGE_KEYS.issues));
export const readViews = (): CvCoachViewsData | null =>
  parse(viewsSchema, read(CV_COACH_VIEWS_KEY));
export const readCoachState = (): CvCoachState | null =>
  parse(cvCoachStateSchema, read(CV_COACH_STORAGE_KEYS.state));
export const readBefore = (): CvCoachBefore | null =>
  parse(cvCoachBeforeSchema, read(CV_COACH_STORAGE_KEYS.before));

/**
 * Guarda lo que devolvió el diagnóstico, validado con los mismos esquemas que se usan al leer. Devuelve los
 * textos para pintar, o `null` si la respuesta no tiene la forma esperada (no se guarda nada a medias).
 */
export function saveDiagnosis(d: {
  issues: unknown;
  heading: unknown;
  views: unknown;
  before: unknown;
}): CvCoachViewsData | null {
  const issues = parse(cvCoachSignedIssuesSchema, d.issues);
  const views = parse(viewsSchema, { heading: d.heading, views: d.views });
  if (!issues || !views) return null;
  if (views.views.map((v) => v.id).join() !== issues.issues.map((i) => i.id).join()) return null;
  write(CV_COACH_STORAGE_KEYS.issues, issues);
  write(CV_COACH_VIEWS_KEY, views);
  const before = parse(cvCoachBeforeSchema, d.before);
  if (before) write(CV_COACH_STORAGE_KEYS.before, before);
  const state: CvCoachState = {
    stage: "diagnosis",
    current: issues.issues[0]?.id ?? null,
    resolved: [],
    skipped: [],
    followUps: 0,
    failures: 0,
    turnsShown: 0,
  };
  write(CV_COACH_STORAGE_KEYS.state, state);
  return views;
}

export function saveCoachState(state: CvCoachState): void {
  write(CV_COACH_STORAGE_KEYS.state, state);
}

/**
 * Todo lo del coach en la pestaña, como un solo texto que se compara por valor (patrón de
 * `profile-agent/read-client.tsx`): en el servidor y en la hidratación no hay nada; después de montar, el
 * navegador lo entrega. Los componentes lo parsean con `parseCoachSnapshot`, sin `setState` en un efecto.
 */
const COACH_KEYS = [
  PROFILE_AGENT_STORAGE_KEYS.ticket,
  CV_COACH_STORAGE_KEYS.issues,
  CV_COACH_VIEWS_KEY,
  CV_COACH_STORAGE_KEYS.state,
  CV_COACH_STORAGE_KEYS.before,
] as const;
const SERVER_SNAPSHOT = "server";
const subscribeNothing = (): (() => void) => () => {};
function readSnapshot(): string {
  try {
    return JSON.stringify(COACH_KEYS.map((k) => window.sessionStorage.getItem(k)));
  } catch {
    return JSON.stringify(COACH_KEYS.map(() => null));
  }
}

export function useCoachSnapshot(): string {
  return useSyncExternalStore(subscribeNothing, readSnapshot, () => SERVER_SNAPSHOT);
}

export type CoachStored = {
  /** `false` en el servidor y en la hidratación: todavía no se sabe qué hay. */
  ready: boolean;
  ticket: string | null;
  issues: CvCoachSignedIssues | null;
  views: CvCoachViewsData | null;
  state: CvCoachState | null;
  before: CvCoachBefore | null;
};

export function parseCoachSnapshot(snapshot: string): CoachStored {
  if (snapshot === SERVER_SNAPSHOT) {
    return { ready: false, ticket: null, issues: null, views: null, state: null, before: null };
  }
  let raw: (string | null)[];
  try {
    raw = JSON.parse(snapshot) as (string | null)[];
  } catch {
    raw = [];
  }
  const json = (v: string | null | undefined): unknown => {
    if (!v) return null;
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  };
  const issues = parse(cvCoachSignedIssuesSchema, json(raw[1]));
  const views = parse(viewsSchema, json(raw[2]));
  return {
    ready: true,
    ticket: typeof raw[0] === "string" ? raw[0] : null,
    issues,
    // los textos valen solo si son de la misma lista (mismos ids, en el mismo orden)
    views:
      issues &&
      views &&
      views.views.map((v) => v.id).join() === issues.issues.map((i) => i.id).join()
        ? views
        : null,
    state: parse(cvCoachStateSchema, json(raw[3])),
    before: parse(cvCoachBeforeSchema, json(raw[4])),
  };
}
