import { schema as s } from "@job-search-os/db";
import {
  suggestedSkills,
  type CvProposal,
  type ProfileAgentPlan,
  type RoleKey,
  type SkillTaxonomyEntry,
} from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { getTargetRoles } from "@/lib/onboarding";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { getSkillTaxonomy } from "@/lib/skill-taxonomy";
import { getUserPlan } from "@/lib/user-plan";

/**
 * Parte de servidor de la lectura del CV del agente de perfil (ADR-034, R10-1). Todo lo que toca datos de
 * la persona va con `withUser` (RLS); las medidas de gasto globales las hace el adaptador con la conexión
 * de servicio que abre la ruta. Nada de esto guarda el CV, su texto ni la propuesta.
 */

export type ReadContext = {
  displayName: string | null;
  roles: RoleKey[];
  taxonomy: SkillTaxonomyEntry[];
  roleSkillSlugs: string[];
  plan: ProfileAgentPlan;
};

/**
 * Lo que la lectura necesita de la persona: su nombre (para redactarlo del CV antes del modelo), los
 * puestos que ya eligió (puede no haber ninguno durante el onboarding), la taxonomía de skills y su plan.
 */
export async function loadReadContext(userId: string, now: Date): Promise<ReadContext> {
  const [profile, roles, taxonomy, plan] = await Promise.all([
    withUser(userId, (tx) =>
      tx
        .select({ name: s.profiles.displayName })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .limit(1),
    ),
    getTargetRoles(userId),
    getSkillTaxonomy(),
    getUserPlan(userId, now),
  ]);
  return {
    displayName: profile[0]?.name ?? null,
    roles,
    taxonomy: taxonomy.map(({ slug, name, aliases }) => ({ slug, name, aliases })),
    roleSkillSlugs: roles.flatMap((r) => suggestedSkills(r, ROLE_SKILLS)),
    plan: plan.plan.key === "gratis" ? "free" : "paid",
  };
}

/** Lo que el navegador recibe de una lectura: conteos y puestos sugeridos. Nada del texto del CV. */
export type ReadSummary = {
  experience: number;
  education: number;
  skills: number;
  languages: number;
  /** Cuántas propuestas descartó el código (datos sensibles, inyección, fechas inválidas). */
  dropped: number;
  suggestedRoles: string[];
};

/**
 * Qué se entiende de la propuesta, en conteos. R10-2 amplía esta respuesta con las tarjetas editables
 * (`ProfileReadProposal`), ya revisadas con `screenProfileCards`; hasta entonces el navegador solo muestra
 * cuánto se leyó.
 */
export function buildReadSummary(proposal: CvProposal): ReadSummary {
  return {
    experience: proposal.workHistory.length,
    education: proposal.education.length,
    skills: proposal.skills.length,
    languages: proposal.languages.length,
    dropped: Object.values(proposal.flags.dropped).reduce((t, n) => t + (n ?? 0), 0),
    suggestedRoles: [...proposal.suggestedRoles],
  };
}
