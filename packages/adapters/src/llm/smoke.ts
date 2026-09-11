import { createDb, loadLocalEnv, requireDatabaseUrl, schema as s } from "@job-search-os/db";
import { buildEvaluateJobVars, outputSchemaFor } from "@job-search-os/pipeline";
import { and, desc, eq } from "drizzle-orm";
import { createLogger } from "../logger";
import { drizzleCallSink } from "./calls";
import { createLlmClient } from "./client";
import { createProviderRegistry } from "./providers";
import { cachedRouteSource, drizzleRouteSource } from "./router";

/**
 * Criterio de aceptación de JS-005: llamada real con evaluate_job@v1 sobre el job 33
 * del golden (id 33) → JSON válido + fila en llm_calls.
 * Uso: pnpm --filter @job-search-os/adapters llm:smoke [golden_id]
 */
async function main(): Promise<void> {
  loadLocalEnv();
  // Flags (--local) las interpreta env.ts; el primer argumento sin guiones es el id del golden
  const goldenId = process.argv.slice(2).find((x) => !x.startsWith("--")) ?? "33";
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "migration" }));
  const logger = createLogger({ run_id: `smoke-${Date.now()}` });

  try {
    const [found] = await db
      .select({ job: s.jobs })
      .from(s.jobs)
      .innerJoin(s.jobSources, eq(s.jobSources.jobId, s.jobs.id))
      .where(and(eq(s.jobSources.sourceName, "golden"), eq(s.jobSources.externalId, goldenId)))
      .limit(1);
    if (!found) throw new Error(`no existe el job golden ${goldenId}; corré pnpm db:seed`);
    const job = found.job;

    const [profile] = await db.select().from(s.profiles).where(eq(s.profiles.userId, job.userId));
    const [criteria] = await db
      .select()
      .from(s.evaluationCriteria)
      .where(
        and(eq(s.evaluationCriteria.userId, job.userId), eq(s.evaluationCriteria.active, true)),
      )
      .orderBy(desc(s.evaluationCriteria.version))
      .limit(1);
    if (!profile || !criteria) throw new Error("faltan perfil o criterios; corré pnpm db:seed");

    // El golden no trae la JD completa: usamos el resumen humano guardado en la evaluación
    const [human] = await db
      .select({ raw: s.evaluations.raw })
      .from(s.evaluations)
      .where(and(eq(s.evaluations.jobId, job.id), eq(s.evaluations.model, "human")))
      .limit(1);
    const raw = (human?.raw ?? {}) as { stack?: string[]; senales?: string[]; nivel?: string };
    const jdSummary = [
      raw.nivel ? `Nivel: ${raw.nivel}` : null,
      raw.stack?.length ? `Requisitos y stack (resumen): ${raw.stack.join("; ")}` : null,
      raw.senales?.length ? `Otros datos del aviso: ${raw.senales.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const vars = buildEvaluateJobVars({
      profile: {
        profileSummary: profile.profileSummary ?? "",
        locationCountry: profile.locationCountry,
        locationCity: profile.locationCity,
        remoteOnly: profile.remoteOnly,
        workAuth: profile.workAuth,
        salaryFloorUsd: profile.salaryFloorUsd,
        maxWeeklyHours: profile.maxWeeklyHours,
        englishCefr: profile.englishCefr,
        yearsTotal: profile.yearsTotal,
      },
      rules: criteria.rules,
      job: { ...job, jdText: job.jdText ?? (jdSummary || null) },
    });
    // Resumen humano ≠ JD completa: que el modelo lo sepa
    vars.had_full_jd = Boolean(job.jdText);

    const client = createLlmClient({
      routes: cachedRouteSource(drizzleRouteSource(db)),
      calls: drizzleCallSink(db),
      providers: createProviderRegistry(),
      logger,
    });

    const result = await client.generateStructured(
      "evaluate_job",
      outputSchemaFor("evaluate_job@v1"),
      vars,
      {
        userId: job.userId,
        jobId: job.id,
      },
    );

    if (!result.ok) {
      console.error("FALLÓ:", result.error);
      process.exitCode = 1;
    } else {
      const { object, ...meta } = result.value;
      console.log(`=== ${job.title} (${job.companyRaw}) · golden ${goldenId} ===`);
      console.log(JSON.stringify(object, null, 2));
      console.log("meta:", JSON.stringify(meta));
    }

    const [call] = await db
      .select()
      .from(s.llmCalls)
      .where(eq(s.llmCalls.jobId, job.id))
      .orderBy(desc(s.llmCalls.createdAt))
      .limit(1);
    console.log("llm_calls:", JSON.stringify(call));
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("smoke falló:", error);
  process.exit(1);
});
