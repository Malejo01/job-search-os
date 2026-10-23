import { schema as s, type Db } from "@job-search-os/db";
import {
  DEMO_PROFILES,
  SHOWCASE_SOURCES,
  SHOWCASE_OFFERS_FRESH_MS,
  demoCriteriaRules,
  type DemoProfile,
  type DemoProfileKey,
} from "@job-search-os/pipeline";
import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { DEFAULT_PROMPT_VERSIONS } from "../llm/client";
import type { LlmClient } from "../llm/types";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { selectPoolCandidates, type RankedPick } from "../pool/select";
import { evaluateForProfile } from "../worker/evaluate-job";

/**
 * Corrida de la demo guiada (ronda 74): para cada perfil inventado de `DEMO_PROFILES` elige hasta
 * `JOBS_PER_PROFILE` avisos reales del pool, los evalúa con el mismo núcleo que el worker
 * (`evaluateForProfile`) y guarda el resultado en `demo_evaluations`. Se dispara una vez por semana:
 * la página pública solo lee. Corta por tope de gasto semanal (en código, antes de cada llamada) y por
 * presupuesto de tiempo. No toca tablas de usuarios.
 */

/** Tarea con la que se registran las llamadas en `llm_calls` (no es una tarea de `model_routing`). */
export const DEMO_RECORD_TASK = "demo:evaluate_job";
/** Etiqueta de las llamadas. No usar "demo": es la del cliente LLM falso (llm/demo.ts). */
export const DEMO_CALL_LABEL = "vitrina-demo";
export const JOBS_PER_PROFILE = 8;
/** Tope de gasto en 7 días móviles (USD). */
export const DEMO_WEEKLY_CAP_USD = 1.0;
/**
 * Reserva por iteración (USD). El máximo observado de una evaluación es 0,0148, pero una iteración con
 * fallback y reintento puede registrar 2 filas, así que se reserva 0,05. El tope es, entonces,
 * "USD 1 más una iteración": se corta antes de llamar si gastado + reserva supera el tope, pero lo
 * que cuesta la última llamada puede pasarlo.
 */
export const COSTO_MAX_ESTIMADO = 0.05;
/** Ventana del guard de concurrencia: filas de la demo más recientes que esto = otra corrida en curso. */
export const RUNNING_WINDOW_MS = 5 * 60 * 1000;
/** Lo evaluado hace más que esto se reevalúa. */
export const DEMO_REFRESH_DAYS = 7;
/** Presupuesto de tiempo: la función tiene maxDuration de 300 s (igual que el worker). */
export const DEMO_BUDGET_MS = 240_000;
/** Margen antes de la primera evaluación: lo que se supone que tarda una. */
const DEFAULT_MARGIN_MS = 30_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DemoRunSummary = {
  /** Evaluaciones nuevas o refrescadas en esta corrida. */
  evaluated: number;
  /** Ya frescas y en la selección: no se tocaron. */
  kept: number;
  /** Filas borradas porque el aviso salió de la selección. */
  removed: number;
  /** Evaluaciones que fallaron (error del modelo o de la base): quedan para la próxima corrida. */
  skipped: number;
  /** Gasto de los últimos 7 días en `demo:evaluate_job`, al terminar (USD). */
  spentWeekUsd: number;
  /** running: otra corrida en curso; cap_unverifiable: una llamada no quedó en llm_calls. */
  stopped: "cap" | "budget" | "running" | "cap_unverifiable" | null;
};

export type RunDemoInput = {
  db: Db;
  llm: LlmClient;
  logger: Logger;
  now?: () => Date;
  budgetMs?: number;
  capUsd?: number;
};

export type DemoSpendState = {
  /** USD de los últimos 7 días; una llamada sin costo (sin tarifa o fallida) cuenta como COSTO_MAX_ESTIMADO. */
  usd: number;
  /** Filas de la demo en llm_calls de los últimos 7 días. */
  calls: number;
  /** Filas de los últimos 5 minutos: otra corrida en curso. */
  recentCalls: number;
};

export async function demoSpendState(db: Db, now: Date): Promise<DemoSpendState> {
  const recentSince = new Date(now.getTime() - RUNNING_WINDOW_MS);
  const [row] = await db
    .select({
      usd: sql<number>`coalesce(sum(coalesce(${s.llmCalls.costUsd}, ${COSTO_MAX_ESTIMADO})), 0)::float8`,
      calls: sql<number>`count(*)::int`,
      recentCalls: sql<number>`count(*) filter (where ${s.llmCalls.createdAt} >= ${recentSince.toISOString()}::timestamptz)::int`,
    })
    .from(s.llmCalls)
    .where(
      and(
        eq(s.llmCalls.task, DEMO_RECORD_TASK),
        gte(s.llmCalls.createdAt, new Date(now.getTime() - 7 * DAY_MS)),
      ),
    );
  return row ?? { usd: 0, calls: 0, recentCalls: 0 };
}

/** Los avisos de un perfil: ranking del pool y filtros de la vitrina (fuentes permitidas, 72 h, con JD). */
export async function selectDemoJobs(
  db: Db,
  profile: DemoProfile,
  now: Date,
): Promise<RankedPick[]> {
  const sel = await selectPoolCandidates(db, {
    userId: null,
    rules: demoCriteriaRules(),
    prefs: {
      country: profile.profile.locationCountry,
      remoteOnly: profile.profile.remoteOnly,
      targetRoles: profile.targetRoles,
      yearsTotal: profile.profile.yearsTotal,
    },
    levelBySkill: new Map(),
    now,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const freshSince = now.getTime() - SHOWCASE_OFFERS_FRESH_MS;
  const roles = new Set<string>(profile.targetRoles);
  return sel.ranked
    .filter(
      (r) =>
        (SHOWCASE_SOURCES as readonly string[]).includes(r.row.sourceKind) &&
        r.row.lastSeenAt.getTime() >= freshSince &&
        Boolean(r.row.jdText?.trim()) &&
        r.row.roleHints.some((h) => roles.has(h)),
    )
    .slice(0, JOBS_PER_PROFILE);
}

export async function runDemoEvaluations(input: RunDemoInput): Promise<DemoRunSummary> {
  const { db, llm } = input;
  const now = input.now ?? (() => new Date());
  const capUsd = input.capUsd ?? DEMO_WEEKLY_CAP_USD;
  const budgetMs = input.budgetMs ?? DEMO_BUDGET_MS;
  const promptVersion = DEFAULT_PROMPT_VERSIONS.evaluate_job ?? "evaluate_job@v1";
  const log = input.logger.child({ cron: "demo" });
  const summary: DemoRunSummary = {
    evaluated: 0,
    kept: 0,
    removed: 0,
    skipped: 0,
    spentWeekUsd: 0,
    stopped: null,
  };

  // 0. Guard de concurrencia: si otra corrida registró llamadas hace menos de 5 minutos, no se hace nada
  if ((await demoSpendState(db, now())).recentCalls > 0) {
    summary.stopped = "running";
    log.warn("demo: hay llamadas de los últimos 5 minutos, otra corrida en curso");
    return summary;
  }

  // 1. Selección por perfil, limpieza de lo que salió y detección de lo que falta o está viejo
  const staleBefore = now().getTime() - DEMO_REFRESH_DAYS * DAY_MS;
  const todo: { profile: DemoProfile; pick: RankedPick }[][] = [];
  for (const profile of DEMO_PROFILES) {
    const picks = await selectDemoJobs(db, profile, now());
    const ids = picks.map((p) => p.row.id);
    // Sin avisos (pool vacío o caído) no se borra nada: mejor la demo de la semana pasada que una vacía
    if (ids.length) {
      const removed = await db
        .delete(s.demoEvaluations)
        .where(
          and(
            eq(s.demoEvaluations.profileKey, profile.key),
            notInArray(s.demoEvaluations.publicJobId, ids),
          ),
        )
        .returning({ id: s.demoEvaluations.id });
      summary.removed += removed.length;
    }
    const existing = ids.length
      ? await db
          .select({
            publicJobId: s.demoEvaluations.publicJobId,
            evaluatedAt: s.demoEvaluations.evaluatedAt,
            promptVersion: s.demoEvaluations.promptVersion,
            checklist: s.demoEvaluations.checklist,
          })
          .from(s.demoEvaluations)
          .where(
            and(
              eq(s.demoEvaluations.profileKey, profile.key),
              inArray(s.demoEvaluations.publicJobId, ids),
            ),
          )
      : [];
    const byJob = new Map(existing.map((e) => [e.publicJobId, e]));
    const pending: { profile: DemoProfile; pick: RankedPick }[] = [];
    for (const pick of picks) {
      const e = byJob.get(pick.row.id);
      // Sin checklist (filas de antes de la ronda 115) se reevalúa: si no, la página no lo mostraría
      // hasta que la fila venza por antigüedad
      if (
        e &&
        e.evaluatedAt.getTime() >= staleBefore &&
        e.promptVersion === promptVersion &&
        e.checklist != null
      )
        summary.kept++;
      else pending.push({ profile, pick });
    }
    todo.push(pending);
  }

  // 2. Intercalado por posición para que un corte no deje a un perfil sin nada
  const queue: { profile: DemoProfile; pick: RankedPick }[] = [];
  for (let i = 0; todo.some((t) => i < t.length); i++) {
    for (const t of todo) if (t[i]) queue.push(t[i]!);
  }

  // 3. Evaluación con tope de gasto y de tiempo, ambos revisados antes de cada llamada
  const startMs = now().getTime();
  let slowestMs = 0;
  for (const { profile, pick } of queue) {
    const elapsed = now().getTime() - startMs;
    if (elapsed + (slowestMs || DEFAULT_MARGIN_MS) > budgetMs) {
      summary.stopped = "budget";
      break;
    }
    const before = await demoSpendState(db, now());
    if (before.usd + COSTO_MAX_ESTIMADO > capUsd) {
      summary.stopped = "cap";
      break;
    }
    const callStart = now().getTime();
    try {
      const r = await evaluateForProfile({
        llm,
        promptVersion,
        profile: profile.profile,
        rules: demoCriteriaRules(),
        job: { ...pick.row, matchedRole: pick.matchedRole, flags: pick.flags },
        // Sin userId: no es de ninguna persona. recordTask/label separan el gasto de la demo.
        ctx: { recordTask: DEMO_RECORD_TASK, label: DEMO_CALL_LABEL },
      });
      slowestMs = Math.max(slowestMs, now().getTime() - callStart);
      const touched = r.ok ? r.sanitized.filter((f) => PUBLISHED_LIST_FIELDS.has(f)) : [];
      if (!r.ok) {
        summary.skipped++;
        log.warn({ profile: profile.key, kind: r.error.kind }, "evaluación de la demo falló");
      } else if (r.injection.hit || touched.length) {
        // Aviso con instrucciones al evaluador o salida que el saneado tuvo que tocar: no se publica
        // (es texto de un tercero en una página pública) y se retira lo que hubiera de antes.
        summary.skipped++;
        await db
          .delete(s.demoEvaluations)
          .where(
            and(
              eq(s.demoEvaluations.profileKey, profile.key),
              eq(s.demoEvaluations.publicJobId, pick.row.id),
            ),
          );
        log.warn(
          { profile: profile.key, injection: r.injection.hit, sanitized: touched },
          "evaluación de la demo no publicada",
        );
      } else {
        await saveEvaluation(db, profile.key, pick.row.id, promptVersion, r, now());
        summary.evaluated++;
      }
    } catch (e) {
      summary.skipped++;
      log.error({ profile: profile.key, err: safeDbError(e) }, "evaluación de la demo falló");
    }
    // El tope solo vale si cada llamada queda en llm_calls: si no quedó, no se sigue gastando a ciegas
    const after = await demoSpendState(db, now()).catch(() => null);
    if (!after || after.calls <= before.calls) {
      summary.stopped = "cap_unverifiable";
      log.error(
        { profile: profile.key },
        "demo: la llamada no quedó registrada en llm_calls; se corta",
      );
      break;
    }
  }

  summary.spentWeekUsd = (await demoSpendState(db, now()).catch(() => null))?.usd ?? 0;
  log.info({ ...summary }, "demo: corrida terminada");
  return summary;
}

// Campos de la evaluación que terminan en la página pública: si el saneado tocó alguno, no se
// publica. `paises_permitidos` y `years_domain` entran vía el checklist (ronda 115).
const PUBLISHED_LIST_FIELDS = new Set([
  "match_fuerte",
  "gaps",
  "riesgos",
  "bloqueadores_duros",
  "paises_permitidos",
  "years_domain",
]);

async function saveEvaluation(
  db: Db,
  profileKey: DemoProfileKey,
  publicJobId: string,
  promptVersion: string,
  r: Extract<Awaited<ReturnType<typeof evaluateForProfile>>, { ok: true }>,
  evaluatedAt: Date,
): Promise<void> {
  const values = {
    promptVersion,
    model: r.model,
    score: r.decision.scoreFinal,
    scoreModel: r.decision.scoreModel,
    accion: r.decision.accion,
    matchFuerte: r.evaluation.match_fuerte,
    gaps: r.evaluation.gaps.map((g) => `${g.skill} (${g.nivel})`),
    bloqueadores: r.decision.bloqueadores,
    riesgos: r.decision.riesgos,
    veredicto: r.evaluation.veredicto,
    locationOk: r.decision.locationOk,
    // Sin skills del perfil (la demo no usa checklistSkills): sale sin esa sección. Null si buildChecklist falló
    checklist: r.checklist,
    evaluatedAt,
  };
  await db
    .insert(s.demoEvaluations)
    .values({ profileKey, publicJobId, ...values })
    .onConflictDoUpdate({
      target: [s.demoEvaluations.profileKey, s.demoEvaluations.publicJobId],
      set: values,
    });
}
