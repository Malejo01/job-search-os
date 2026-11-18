import { suggestedSkills, type AtsSkill } from "@job-search-os/pipeline";
import { getTargetRoles } from "@/lib/onboarding";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { getSkillTaxonomy } from "@/lib/skill-taxonomy";

/** Tope de skills que se mandan al navegador para la revisión. */
const MAX_ATS_SKILLS = 30;

/**
 * Skills de la carrera objetivo de la persona (nombre y alias del catálogo), para la revisión «legible por los
 * filtros» (R14-2). Es el catálogo público, no el CV; sin carrera elegida da `[]` y esa revisión se omite.
 */
export async function loadAtsCareerSkills(userId: string): Promise<AtsSkill[]> {
  const [roles, taxonomy] = await Promise.all([getTargetRoles(userId), getSkillTaxonomy()]);
  const slugs = new Set(roles.flatMap((r) => suggestedSkills(r, ROLE_SKILLS)));
  return taxonomy
    .filter((t) => slugs.has(t.slug))
    .slice(0, MAX_ATS_SKILLS)
    .map((t) => ({ name: t.name, aliases: t.aliases }));
}
