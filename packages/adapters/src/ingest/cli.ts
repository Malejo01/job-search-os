import {
  createDb,
  describeDatabaseUrl,
  loadLocalEnv,
  requireDatabaseUrl,
  schema as s,
} from "@job-search-os/db";
import { desc, eq, sql } from "drizzle-orm";
import { createLogger } from "../logger";
import { runGetOnBoardIngest } from "./run-getonboard";

/**
 * Corrida manual de la ingesta de Get on Board (criterio de aceptación de JS-012).
 *   pnpm ingest:getonboard [--local] [--since-hours 24] [--user <uuid>]
 * Conecta como servicio (dueño): filtra por user_id explícito.
 */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadLocalEnv();
  process.env.LOG_LEVEL ??= "warn";
  const url = requireDatabaseUrl({ purpose: "service" });
  const { db, close } = createDb(url, { max: 2 });
  const logger = createLogger();
  try {
    console.log(`→ ${describeDatabaseUrl(url)}`);
    const result = await runGetOnBoardIngest({
      db,
      logger,
      sinceHours: flag("since-hours") ? Number(flag("since-hours")) : 24,
      userId: flag("user"),
    });
    console.log(
      `descarga: ${result.fetched.jobs} ofertas desde ${result.since} (${result.fetched.seen} vistas en ${result.fetched.pagesFetched} páginas), ${(result.durationMs / 1000).toFixed(1)} s`,
    );
    for (const u of result.users) {
      const st = Object.entries(u.summary.byStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      console.log(
        `usuario ${u.userId.slice(0, 8)}: insertados ${u.summary.inserted} (${st || "-"}), fusionados ${u.summary.merged}, encolados ${u.summary.enqueued}, errores ${u.summary.errors.length}`,
      );
      for (const e of u.summary.errors) console.log(`  ! ${e.externalId}: ${e.error}`);
    }

    const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(s.jobs);
    const [gob] = await db
      .select({ n: sql<number>`count(distinct ${s.jobSources.jobId})::int` })
      .from(s.jobSources)
      .where(eq(s.jobSources.kind, "getonboard_api"));
    console.log(`jobs en DB: ${total?.n} (con fuente Get on Board: ${gob?.n})`);

    const latest = await db
      .select({
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        status: s.jobs.status,
        location: s.jobs.locationRaw,
        reason: s.jobs.prefilterReason,
        flags: s.jobs.flags,
      })
      .from(s.jobs)
      .innerJoin(s.jobSources, eq(s.jobSources.jobId, s.jobs.id))
      .where(eq(s.jobSources.kind, "getonboard_api"))
      .orderBy(desc(s.jobs.createdAt))
      .limit(12);
    console.table(
      latest.map((r) => ({
        title: r.title.slice(0, 48),
        company: r.company.slice(0, 22),
        status: r.status,
        location: (r.location ?? "").slice(0, 34),
        reason: (r.reason ?? "").slice(0, 34),
        flags: (r.flags ?? []).join(","),
      })),
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("ingest:getonboard falló:", error);
  process.exit(1);
});
