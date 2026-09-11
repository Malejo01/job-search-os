import { schema as s, type Db } from "@job-search-os/db";
import { compileTaxonomy, extractSkillsFromText, type Term } from "@job-search-os/pipeline";
import { eq, inArray } from "drizzle-orm";

/**
 * job_skills desde el texto de la JD, sin LLM (adelanto de JS-030 y base del pre-score offline).
 * Se recalcula entero por job cada vez que cambia la JD; must=true porque en una JD no se puede
 * saber sin modelo qué es requisito y qué deseable (raw_mention lo aclara).
 */
export async function loadTaxonomy(db: Db): Promise<Term[]> {
  const rows = await db
    .select({ slug: s.skills.slug, name: s.skills.name, aliases: s.skills.aliases })
    .from(s.skills);
  return compileTaxonomy(rows);
}

export async function syncJobSkillsFromText(
  db: Db,
  jobId: string,
  text: string,
  terms: readonly Term[],
): Promise<number> {
  const slugs = extractSkillsFromText(text, terms);
  await db.delete(s.jobSkills).where(eq(s.jobSkills.jobId, jobId));
  if (!slugs.length) return 0;
  const ids = await db
    .select({ id: s.skills.id, slug: s.skills.slug })
    .from(s.skills)
    .where(inArray(s.skills.slug, slugs));
  if (!ids.length) return 0;
  await db
    .insert(s.jobSkills)
    .values(ids.map((k) => ({ jobId, skillId: k.id, isMust: true, rawMention: "jd" })));
  return ids.length;
}
