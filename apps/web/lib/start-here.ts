import { schema as s } from "@job-search-os/db";
import type { StartHereFacts } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { cvChatAllowed } from "./cv-chat-server";
import { withUser } from "./db";

/**
 * «Empezá acá» de /hoy (C8-5). Apagado por defecto: `START_HERE_ENABLED=1` lo prende. Los hechos
 * salen de una sola consulta con RLS y subconsultas de existencia (sin migración). Si algo falla, la
 * tarjeta no se muestra: no es central.
 */
export function startHereEnabled(): boolean {
  return process.env.START_HERE_ENABLED === "1";
}

export async function getStartHereFacts(userId: string): Promise<StartHereFacts> {
  const [row, cvEnabled] = await Promise.all([
    withUser(userId, async (tx) => {
      const [r] = await tx
        .select({
          summaryFilled: sql<boolean>`coalesce(char_length(btrim(${s.profiles.profileSummary})) > 0, false)`,
          targetRoles: s.profiles.targetRoles,
          specialtiesSaved: sql<boolean>`${s.profiles.targetSpecialties} is not null`,
          skillsLoaded: sql<boolean>`exists (select 1 from ${s.skillLevels} where ${s.skillLevels.userId} = ${userId} and ${s.skillLevels.level} > 0)`,
          hasJobs: sql<boolean>`exists (select 1 from ${s.jobs} where ${s.jobs.userId} = ${userId})`,
          cvStarted: sql<boolean>`exists (select 1 from ${s.careerHistory} where ${s.careerHistory.userId} = ${userId})`,
        })
        .from(s.profiles)
        .where(sql`${s.profiles.userId} = ${userId}`);
      return r;
    }),
    cvChatAllowed(userId).catch(() => false),
  ]);
  return {
    summaryFilled: Boolean(row?.summaryFilled),
    skillsLoaded: Boolean(row?.skillsLoaded),
    targetRoles: row?.targetRoles ?? [],
    specialtiesSaved: Boolean(row?.specialtiesSaved),
    hasJobs: Boolean(row?.hasJobs),
    cvEnabled,
    cvStarted: Boolean(row?.cvStarted),
  };
}
