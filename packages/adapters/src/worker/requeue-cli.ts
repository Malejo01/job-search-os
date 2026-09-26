import {
  createDb,
  describeDatabaseUrl,
  loadLocalEnv,
  requireDatabaseUrl,
  schema as s,
} from "@job-search-os/db";
import { requeueAllowed, type JobStatus } from "@job-search-os/pipeline";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";

/**
 * Re-encola ofertas YA evaluadas para volver a evaluarlas con el modelo real (gasta LLM).
 * Con --model solo toca `evaluada`; con --job también aplicada, entrevista y oferta, que se
 * re-evalúan sin moverles el estado ni tocar la postulación (JS-057).
 *   pnpm worker:requeue [--local] (--model fake | --job <uuid o prefijo> [--job ...]) [--force]
 * Sin --force solo lista lo que haría y el costo estimado; con --force encola (idempotente: si ya
 * hay un mensaje pending para ese job no duplica). Después: pnpm worker:evaluate [--local].
 * Es un comando de CLI a propósito (no un botón en la UI) para no re-evaluar sin querer.
 */
function flags(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  });
  return out;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireDatabaseUrl({ purpose: "service" });
  const { db, close } = createDb(url, { max: 2 });
  try {
    console.log(`→ ${describeDatabaseUrl(url)}`);
    const model = flags("model")[0];
    const jobArgs = flags("job");
    if (!model && jobArgs.length === 0) {
      throw new Error(
        "indicá --model <modelo de la última evaluación, ej. fake> o --job <id> (uno o más)",
      );
    }

    // Última evaluación por job (la que muestra la UI)
    const latest = db
      .selectDistinctOn([s.evaluations.jobId], {
        jobId: s.evaluations.jobId,
        model: s.evaluations.model,
        score: s.evaluations.score,
        promptVersion: s.evaluations.promptVersion,
      })
      .from(s.evaluations)
      .orderBy(s.evaluations.jobId, desc(s.evaluations.createdAt))
      .as("latest");
    const where = model
      ? eq(latest.model, model)
      : or(
          inArray(
            s.jobs.id,
            jobArgs.filter((j) => j.length === 36),
          ),
          ...jobArgs
            .filter((j) => j.length < 36)
            .map((p) => sql`${s.jobs.id}::text like ${p + "%"}`),
        );
    const rows = await db
      .select({
        id: s.jobs.id,
        userId: s.jobs.userId,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        status: s.jobs.status,
        model: latest.model,
        score: latest.score,
        promptVersion: latest.promptVersion,
      })
      .from(s.jobs)
      .innerJoin(latest, eq(latest.jobId, s.jobs.id))
      .where(where);
    // --model es masivo: solo `evaluada`. --job es una decisión explícita sobre ofertas puntuales:
    // también las que ya tienen una postulación en curso, que se re-evalúan sin moverles el
    // estado (JS-057). Lo terminal no entra en ningún caso.
    const mode = model ? "bulk" : "explicit";
    const candidates = rows.filter((r) => requeueAllowed(r.status as JobStatus, mode));
    const skipped = rows.filter((r) => !requeueAllowed(r.status as JobStatus, mode));

    const [route] = await db
      .select({
        model: s.modelRouting.model,
        inUsd: s.modelRouting.inputUsdPerMtok,
        outUsd: s.modelRouting.outputUsdPerMtok,
      })
      .from(s.modelRouting)
      .where(eq(s.modelRouting.task, "evaluate_job"));
    // Tokens medidos el 2026-09-11 con thinking minimal (docs/LLM_COSTOS.md)
    const perCall =
      route && route.inUsd !== null && route.outUsd !== null
        ? (1950 * route.inUsd + 430 * route.outUsd) / 1e6
        : null;

    console.table(
      candidates.map((r) => ({
        id: r.id.slice(0, 8),
        title: r.title.slice(0, 45),
        company: r.company.slice(0, 22),
        modelo_actual: r.model,
        score: r.score,
        prompt: r.promptVersion,
      })),
    );
    for (const r of skipped) {
      console.log(
        mode === "bulk"
          ? `  omitido ${r.id.slice(0, 8)} (${r.status}): el requeue masivo solo toca 'evaluada'; para esta usá --job`
          : `  omitido ${r.id.slice(0, 8)} (${r.status}): estado terminal o sin evaluar, no se re-evalúa`,
      );
    }
    if (candidates.length === 0) {
      console.log("nada para re-encolar");
      return;
    }
    console.log(
      `${candidates.length} ofertas × ${route?.model ?? "?"} ≈ USD ${perCall === null ? "?" : (perCall * candidates.length).toFixed(3)} (estimado: 1950 in / 430 out por llamada)`,
    );
    if (!process.argv.includes("--force")) {
      console.log("simulación: agregá --force para encolar de verdad");
      return;
    }
    const enqueue = enqueueEvaluationWith(db, createPgQueue(db));
    for (const r of candidates) await enqueue(r.id, r.userId);
    console.log(
      `encoladas ${candidates.length}; cola: ${JSON.stringify(await createPgQueue(db).stats(EVALUATE_QUEUE))}. Ahora: pnpm worker:evaluate${process.argv.includes("--local") ? " --local" : ""}`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`worker:requeue falló: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
