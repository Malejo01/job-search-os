import { z } from "zod";
import { SKILL_SLUG } from "../skills/self-assessment";
import { JOB_STATUSES } from "../status";
import { AGENT_LIMITS } from "./limits";
import type { ScreenContext } from "./screen";
import type { ProposalDestination } from "./types";

/**
 * Catálogo de tools del asistente. REGLA ÚNICA: ninguna tool escribe. Las de lectura usan las
 * mismas funciones que la UI y el MCP; las `propose_*` solo devuelven una diferencia antes/después
 * que la persona confirma con un clic y guarda con la Server Action de esa pantalla.
 */
export const AGENT_READ_TOOLS = [
  "get_profile",
  "get_skill_levels",
  "get_criteria",
  "get_target_roles",
  "list_jobs",
  "get_job",
  "market_summary",
] as const;
export const AGENT_PROPOSE_TOOLS = [
  "propose_profile",
  "propose_skill_levels",
  "propose_criteria",
  "propose_target_roles",
] as const;

export type AgentReadTool = (typeof AGENT_READ_TOOLS)[number];
export type AgentProposeTool = (typeof AGENT_PROPOSE_TOOLS)[number];
export type AgentToolName = AgentReadTool | AgentProposeTool;

export function isProposeTool(name: string): name is AgentProposeTool {
  return (AGENT_PROPOSE_TOOLS as readonly string[]).includes(name);
}

export function isAgentTool(name: string): name is AgentToolName {
  return isProposeTool(name) || (AGENT_READ_TOOLS as readonly string[]).includes(name);
}

const DESTINATION_BY_TOOL: Record<AgentProposeTool, ProposalDestination> = {
  propose_profile: "profile",
  propose_skill_levels: "skill_levels",
  propose_criteria: "criteria",
  propose_target_roles: "target_roles",
};

export function proposeToolDestination(name: AgentProposeTool): ProposalDestination {
  return DESTINATION_BY_TOOL[name];
}

/** Fundamento de cada valor propuesto: cita literal del mensaje de la persona o de su perfil. */
export const groundingSchema = z
  .object({ from: z.enum(["message", "profile"]), quote: z.string().min(2).max(300) })
  .strict();

/** Campos del formulario de «Tu perfil» (ProfileFormValues de la app). */
export const PROFILE_FIELDS = [
  "country",
  "city",
  "acceptedModalities",
  "jobLanguage",
  "workAuthUs",
  "workAuthEu",
  "workAuthOther",
  "englishCefr",
  "yearsTotal",
  "summary",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Campos de «Criterios» que el asistente puede proponer (los escalares y las disciplinas). */
export const CRITERIA_FIELDS = [
  "salary_floor_usd_monthly",
  "max_weekly_hours",
  "max_years_hard",
  "english_risk_from",
  "allowed_disciplines",
] as const;
export type CriteriaField = (typeof CRITERIA_FIELDS)[number];

const changeValue = z.union([
  z.string().max(2000),
  z.number(),
  z.array(z.string().max(40)).max(30),
  z.boolean(),
]);

export const proposeProfileInput = z
  .object({
    changes: z
      .array(
        z
          .object({ field: z.enum(PROFILE_FIELDS), value: changeValue, source: groundingSchema })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

export const proposeSkillLevelsInput = z
  .object({
    changes: z
      .array(
        z
          .object({
            slug: z.string().regex(SKILL_SLUG),
            level: z.number().int().min(0).max(3),
            source: groundingSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export const proposeCriteriaInput = z
  .object({
    changes: z
      .array(
        z
          .object({ field: z.enum(CRITERIA_FIELDS), value: changeValue, source: groundingSchema })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();

export const proposeTargetRolesInput = z
  .object({ roles: z.array(z.string().max(40)).min(1).max(20), source: groundingSchema })
  .strict();

export const proposeInputSchemas = {
  propose_profile: proposeProfileInput,
  propose_skill_levels: proposeSkillLevelsInput,
  propose_criteria: proposeCriteriaInput,
  propose_target_roles: proposeTargetRolesInput,
} as const satisfies Record<AgentProposeTool, z.ZodType>;

const empty = z.object({}).strict();

export const readInputSchemas = {
  get_profile: empty,
  get_skill_levels: empty,
  get_criteria: empty,
  get_target_roles: empty,
  list_jobs: z
    .object({
      limit: z.number().int().min(1).max(10).default(5),
      status: z.enum([...JOB_STATUSES, "activas", "todas"]).optional(),
    })
    .strict(),
  get_job: z.object({ id: z.string().uuid() }).strict(),
  market_summary: z.object({ top: z.number().int().min(1).max(10).default(5) }).strict(),
} as const satisfies Record<AgentReadTool, z.ZodType>;

/** Estado del turno para decidir qué tools se le ofrecen al modelo. */
export type TurnState = {
  /** Turno de la conversación, 0-based. */
  turn: number;
  /** Paso dentro del turno, 0-based. */
  step: number;
  /** Propuestas ya devueltas en este turno. */
  proposalsThisTurn: number;
  screen: ScreenContext | null;
};

/**
 * Tools activas en un paso. El último paso del turno no tiene tools (responde en texto) y hay una
 * sola propuesta por turno: después de proponer, solo lectura. Orden estable.
 */
export function activeToolsFor(state: TurnState): AgentToolName[] {
  if (state.turn >= AGENT_LIMITS.maxTurnsPerConversation) return [];
  if (state.step >= AGENT_LIMITS.maxStepsPerTurn - 1) return [];
  if (state.proposalsThisTurn >= 1) return [...AGENT_READ_TOOLS];
  return [...AGENT_READ_TOOLS, ...AGENT_PROPOSE_TOOLS];
}
