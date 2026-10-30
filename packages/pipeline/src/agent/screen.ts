import { z } from "zod";
import { err, ok, type Result } from "../result";
import type { ProposalDestination } from "./types";

/**
 * Contexto de la pantalla actual del asistente. Lista cerrada: el cliente manda en qué pantalla
 * está la persona y, en el detalle de una oferta, su id; nada más. Lo desconocido no se manda.
 */
export const AGENT_SCREENS = [
  "/hoy",
  "/jobs",
  "/jobs/[id]",
  "/applications",
  "/market",
  "/plan",
  "/encaje",
  "/inbox",
  "/settings",
  "/settings/perfil",
  "/settings/skills",
  "/settings/criteria",
] as const;
export type AgentScreen = (typeof AGENT_SCREENS)[number];

export const screenContextSchema = z
  .object({
    screen: z.enum(AGENT_SCREENS),
    jobId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.jobId !== undefined && v.screen !== "/jobs/[id]") {
      ctx.addIssue({ code: "custom", path: ["jobId"], message: "jobId solo en /jobs/[id]" });
    }
  });
export type ScreenContext = z.infer<typeof screenContextSchema>;

export function parseScreenContext(raw: unknown): Result<ScreenContext, "screen_invalida"> {
  const parsed = screenContextSchema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err("screen_invalida");
}

const MAX_PATH_CHARS = 200;

/**
 * Ruta del navegador → contexto. Ignora query y hash; lo que no es una pantalla conocida → null.
 * El id de la oferta se valida con el mismo esquema que `parseScreenContext`, así lo que sale de
 * acá siempre lo acepta la ruta.
 */
export function screenFromPath(pathname: string): ScreenContext | null {
  // Antes de cualquier regex: una ruta enorme no se procesa
  if (pathname.length > MAX_PATH_CHARS) return null;
  const path = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") || "/";
  const job = /^\/jobs\/([^/]+)$/.exec(path);
  if (job) {
    const ctx = { screen: "/jobs/[id]" as const, jobId: (job[1] ?? "").toLowerCase() };
    return screenContextSchema.safeParse(ctx).success ? ctx : null;
  }
  if (path === "/jobs/[id]") return null;
  return (AGENT_SCREENS as readonly string[]).includes(path)
    ? { screen: path as AgentScreen }
    : null;
}

const DESTINATION_BY_SCREEN: Partial<Record<AgentScreen, ProposalDestination>> = {
  "/settings/perfil": "profile",
  "/settings/skills": "skill_levels",
  "/settings/criteria": "criteria",
  "/settings": "target_roles",
};

/** Destino de propuesta natural de la pantalla (el formulario que la persona tiene delante). */
export function destinationForScreen(screen: AgentScreen): ProposalDestination | null {
  return DESTINATION_BY_SCREEN[screen] ?? null;
}

const SCREEN_LABELS: Record<AgentScreen, string> = {
  "/hoy": "Hoy",
  "/jobs": "Ofertas",
  "/jobs/[id]": "Detalle de una oferta",
  "/applications": "Postulaciones",
  "/market": "Mercado",
  "/plan": "Plan de estudio",
  "/encaje": "Tu encaje",
  "/inbox": "Bandeja",
  "/settings": "Ajustes",
  "/settings/perfil": "Tu perfil",
  "/settings/skills": "Tus skills",
  "/settings/criteria": "Criterios",
};

export function screenLabel(screen: AgentScreen): string {
  return SCREEN_LABELS[screen];
}
