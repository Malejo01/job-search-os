import {
  createDb,
  describeDatabaseUrl,
  loadLocalEnv,
  requireDatabaseUrl,
  schema as s,
} from "@job-search-os/db";
import { and, isNotNull, notExists, sql } from "drizzle-orm";
import { loadTaxonomy, syncJobSkillsFromText } from "./sync";

/**
 * pnpm skills:extract [--local] [--all]
 * Rellena job_skills desde jd_text para las ofertas que no tienen skills (o todas con --all).
 * Sin LLM: mapeo determinista por alias. Corre como servicio.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireDatabaseUrl({ purpose: "service" });
  const { db, close } = createDb(url, { max: 2 });
  try {
    console.log(`→ ${describeDatabaseUrl(url)}`);
    const all = process.argv.includes("--all");
    const terms = await loadTaxonomy(db);
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
