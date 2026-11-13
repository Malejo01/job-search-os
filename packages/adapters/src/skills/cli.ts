import {
  createDb,
  describeDatabaseUrl,
  loadLocalEnv,
  requireDatabaseUrl,
  schema as s,
} from "@job-search-os/db";
import { extractJdSkills } from "@job-search-os/pipeline";
import { and, eq, isNotNull, notExists, sql } from "drizzle-orm";
import { resolveTargetUrl } from "../admin/common";
import { diffPoolSkills } from "./pool-diff";
import { loadTaxonomy, syncJobSkillsFromText, syncPublicJobSkillsFromText } from "./sync";

/**
 * pnpm skills:extract [--local] [--all]
 * Rellena job_skills desde jd_text para las ofertas que no tienen skills (o todas con --all).
 * Sin LLM: mapeo determinista por alias. Corre como servicio.
 *
 * pnpm skills:extract --pool [--apply] [--remote]
 * Local por defecto; `--remote` pide escribir «si» en una terminal.
 * Recalcula public_job_skills (el pool) con el detector actual (R11-9: los términos ambiguos
 * necesitan contexto). Sin --apply es un dry-run: muestra cuántos avisos pierden o ganan cada
 * skill y no escribe nada. Con --apply reescribe solo los avisos que cambian.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const poolMode = process.argv.includes("--pool");
  let url: string;
  if (poolMode) {
    // El pool falla cerrado: local por defecto; la nube solo con --remote y confirmando «si» en una
    // terminal (igual que pool:rehint). Sin terminal o con una base ajena a la máquina, no corre.
    const target = await resolveTargetUrl(
      process.argv.includes("--remote"),
      "recalcular las skills del pool",
    );
    if (!target.ok) {
      console.error(target.error);
      process.exitCode = 1;
      return;
    }
    url = target.url;
    console.log(`base: ${target.label}`);
  } else {
    url = requireDatabaseUrl({ purpose: "service" });
    console.log(`→ ${describeDatabaseUrl(url)}`);
  }
  const { db, close } = createDb(url, { max: 2 });
  try {
    const terms = await loadTaxonomy(db);

    if (process.argv.includes("--pool")) {
      const apply = process.argv.includes("--apply");
      const jobs = await db
        .select({ id: s.publicJobs.id, jdText: s.publicJobs.jdText })
        .from(s.publicJobs)
        .where(isNotNull(s.publicJobs.jdText));
      const stored = await db
        .select({ publicJobId: s.publicJobSkills.publicJobId, slug: s.skills.slug })
        .from(s.publicJobSkills)
        .innerJoin(s.skills, eq(s.skills.id, s.publicJobSkills.skillId));
      const before = new Map<string, Set<string>>();
      for (const r of stored) {
        const set = before.get(r.publicJobId) ?? new Set<string>();
        set.add(r.slug);
        before.set(r.publicJobId, set);
      }
      const after = new Map(jobs.map((j) => [j.id, extractJdSkills(j.jdText!, terms)] as const));
      const { diff, changedIds } = diffPoolSkills(before, after);
      console.log(`${jobs.length} avisos con texto, ${diff.changedJobs} cambian`);
      const top = (counts: Record<string, number>) =>
        Object.entries(counts)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([slug, n]) => `${slug}: ${n}`)
          .join(", ") || "ninguna";
      console.log(`pierden: ${top(diff.removedBySlug)}`);
      console.log(`ganan: ${top(diff.addedBySlug)}`);
      if (!apply) {
        console.log("(nada escrito: agregá --apply)");
        return;
      }
      const textById = new Map(jobs.map((j) => [j.id, j.jdText!] as const));
      for (const id of changedIds) {
        await syncPublicJobSkillsFromText(db, id, textById.get(id)!, terms);
      }
      console.log(`${changedIds.length} avisos reescritos`);
      return;
    }

    const all = process.argv.includes("--all");
    const jobs = await db
      .select({ id: s.jobs.id, jdText: s.jobs.jdText })
      .from(s.jobs)
      .where(
        all
          ? isNotNull(s.jobs.jdText)
          : and(
              isNotNull(s.jobs.jdText),
              notExists(
                db
                  .select({ x: sql`1` })
                  .from(s.jobSkills)
                  .where(sql`${s.jobSkills.jobId} = ${s.jobs.id}`),
              ),
            ),
      );
    let total = 0;
    for (const job of jobs) total += await syncJobSkillsFromText(db, job.id, job.jdText!, terms);
    console.log(`${jobs.length} ofertas procesadas, ${total} filas en job_skills`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("skills:extract falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
