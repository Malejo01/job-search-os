/**
 * Datos inventados para los tests del turno del coach (no se exporta desde el índice). Empresas y
 * proyectos ficticios: «Empresa A», «Empresa B», «Proyecto 1».
 */
import { readFileSync } from "node:fs";
import type { CvCoachState, CvCoachTurnOutput, CvIssue } from "../schemas";
import type { CoachTurnSetup } from "./apply";
import type { CvCoachItem } from "./context";
import { parseCoachFallbacks, type CoachFallbacks } from "./templates";

export const ID_A = "00000000-0000-4000-8000-00000000000a";
export const ID_B = "00000000-0000-4000-8000-00000000000b";
export const ID_P1 = "00000000-0000-4000-8000-0000000000c1";

export const ITEMS: CvCoachItem[] = [
  {
    id: ID_A,
    section: "experience",
    organization: "Empresa A",
    title: "Analista de datos",
    startMonth: "2025-02",
    endMonth: "2026-03",
    isCurrent: false,
    bullets: ["Hacía reportes"],
    link: null,
  },
  {
    id: ID_B,
    section: "experience",
    organization: "Empresa B",
    title: "Asistente",
    startMonth: null,
    endMonth: null,
    isCurrent: false,
    bullets: ["Atención de clientes"],
    link: null,
  },
  {
    id: ID_P1,
    section: "projects",
    organization: "Proyecto 1",
    title: "Desarrolladora",
    startMonth: null,
    endMonth: null,
    isCurrent: false,
    bullets: ["App de turnos para un consultorio"],
    link: null,
  },
];

const issue = (n: number, over: Partial<CvIssue>): CvIssue => ({
  id: `iss:${n}`,
  type: "logro_sin_resultado",
  ref: { section: "experience", itemId: ID_A, field: "bullets" },
  quote: null,
  skillSlug: null,
  severity: "alta",
  source: "model",
  ...over,
});

export const ISSUES: CvIssue[] = [
  issue(0, { type: "logro_sin_resultado" }),
  issue(1, {
    type: "proyecto_sin_stack_o_link",
    ref: { section: "projects", itemId: ID_P1, field: "stack" },
  }),
  issue(2, {
    type: "fecha_faltante",
    ref: { section: "experience", itemId: ID_B, field: "dates" },
  }),
  issue(3, {
    type: "brecha_con_puesto",
    ref: { section: "skills", itemId: null, field: null },
    skillSlug: "sql",
    source: "data",
  }),
  issue(4, { type: "resumen_generico", ref: { section: "summary", itemId: null, field: null } }),
];

/** Las plantillas reales (`packages/prompts/cv_coach_fallbacks.v1.md`), sin el frontmatter. */
export function realFallbacksBody(): string {
  const raw = readFileSync(
    new URL("../../../../prompts/cv_coach_fallbacks.v1.md", import.meta.url),
    "utf8",
  );
  return raw.replace(/^---[\s\S]*?---\s*/, "");
}

export function realFallbacks(): CoachFallbacks {
  const r = parseCoachFallbacks(realFallbacksBody());
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

export function setup(over: Partial<CoachTurnSetup> = {}): CoachTurnSetup {
  return {
    items: ITEMS,
    skillNames: { sql: "SQL", excel: "Excel" },
    target: "Analista de datos",
    issues: ISSUES,
    fallbacks: realFallbacks(),
    ...over,
  };
}

export const startState = (over: Partial<CvCoachState> = {}): CvCoachState => ({
  stage: "chat",
  current: "iss:0",
  resolved: [],
  skipped: [],
  followUps: 0,
  failures: 0,
  turnsShown: 0,
  ...over,
});

export const emptyOutput = (over: Partial<CvCoachTurnOutput> = {}): CvCoachTurnOutput => ({
  patch: {
    title: null,
    organization: null,
    startMonth: null,
    endMonth: null,
    isCurrent: null,
    bullets: [],
    link: null,
    stack: [],
  },
  extras: [],
  declined: false,
  nextQuestion: null,
  ...over,
});

export const patch = (p: Partial<CvCoachTurnOutput["patch"]>): Partial<CvCoachTurnOutput> => ({
  patch: { ...emptyOutput().patch, ...p },
});
