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

const SKILLS_INSERT_CHUNK = 5000;

/**
 * Skills de varias filas nuevas del pool de una vez: slugs en memoria, un select de ids con ANY
 * sobre la unión y un insert multi-fila. Solo para filas recién creadas (no borra nada antes).
 */
export async function syncPublicJobSkillsMany(
  db: Db,
  items: readonly { publicJobId: string; text: string }[],
  terms: readonly Term[],
): Promise<number> {
  const perJob = items.map((i) => ({
    publicJobId: i.publicJobId,
    slugs: extractSkillsFromText(i.text, terms),
  }));
  const union = [...new Set(perJob.flatMap((p) => p.slugs))];
  if (!union.length) return 0;
  const ids = await db
    .select({ id: s.skills.id, slug: s.skills.slug })
    .from(s.skills)
    .where(inArray(s.skills.slug, union));
  const idBySlug = new Map(ids.map((k) => [k.slug, k.id]));
  const rows = perJob.flatMap((p) =>
    p.slugs.flatMap((slug) => {
      const skillId = idBySlug.get(slug);
      return skillId
        ? [{ publicJobId: p.publicJobId, skillId, isMust: true, rawMention: "jd" }]
        : [];
    }),
  );
  if (!rows.length) return 0;
  // Trozos de 5.000 filas: el protocolo de Postgres limita los parámetros por consulta
  for (let i = 0; i < rows.length; i += SKILLS_INSERT_CHUNK) {
    await db.insert(s.publicJobSkills).values(rows.slice(i, i + SKILLS_INSERT_CHUNK));
  }
  return rows.length;
}

/** Igual que `syncJobSkillsFromText`, sobre las skills del pool (`public_job_skills`). */
export async function syncPublicJobSkillsFromText(
  db: Db,
  publicJobId: string,
  text: string,
  terms: readonly Term[],
): Promise<number> {
  const slugs = extractSkillsFromText(text, terms);
  await db.delete(s.publicJobSkills).where(eq(s.publicJobSkills.publicJobId, publicJobId));
  if (!slugs.length) return 0;
  const ids = await db
    .select({ id: s.skills.id, slug: s.skills.slug })
    .from(s.skills)
    .where(inArray(s.skills.slug, slugs));
  if (!ids.length) return 0;
  await db
    .insert(s.publicJobSkills)
    .values(ids.map((k) => ({ publicJobId, skillId: k.id, isMust: true, rawMention: "jd" })));
  return ids.length;
}
