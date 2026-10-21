import { schema as s, type Db } from "@job-search-os/db";
import { prefilter, RESIDENCY_FLAG, type JobStatus } from "@job-search-os/pipeline";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Logger } from "../logger";
import { createPgQueue, enqueueEvaluationWith } from "../queue/pg-queue";
import { jdLanguageFor, loadProfilePrefilterPrefs } from "./ingest-job";
import { loadActiveRules } from "./run-getonboard";

/**
 * Re-prefiltro al cambiar el perfil (ronda 91): cuando la persona cambia modalidad, país, ciudad o
 * idioma de las ofertas, los avisos que todavía no se evaluaron vuelven a pasar por el prefiltro con
 * el perfil nuevo. Es el mismo `prefilter` y las mismas preferencias que la ingesta
 * (`loadProfilePrefilterPrefs`, `jdLanguageFor`); no llama a ningún modelo ni reevalúa nada.
 *
 * Solo toca `nueva`, `prefiltrada`, `descartada_prefiltro` y `pendiente_jd`: son los estados previos
 * a la evaluación (status.ts). `evaluada` y los de postulación no se tocan nunca. El estado se
 * asigna directo porque la máquina de estados no tiene la vuelta `descartada_prefiltro → prefiltrada`
 * (es repetir el primer paso, no un paso nuevo). Filtra por `user_id` explícito y, bajo el rol de la
 * app, además rige RLS. Un lock por usuario y la comparación contra el estado actual lo hacen
 * idempotente: una segunda corrida con el mismo perfil no cambia nada.
 */

/** Estados anteriores a la evaluación: los únicos que el re-prefiltro puede tocar. */
export const REPREFILTER_STATUSES = [
  "nueva",
  "prefiltrada",
  "descartada_prefiltro",
  "pendiente_jd",
] as const satisfies readonly JobStatus[];

/**
 * Tope de avisos que vuelven a la cola de evaluación en una corrida. La ingesta no tiene tope, pero
 * acá un cambio de perfil puede rescatar muchos avisos de golpe y cada uno es una llamada paga: el
 * resto queda `prefiltrada`, listo para evaluar, sin mensaje en la cola.
 */
export const REPREFILTER_ENQUEUE_CAP = 20;

/** Banderas que escribe el prefiltro; las demás (`posible_duplicado`, etc.) se conservan. */
const PREFILTER_FLAGS = new Set([
  "modalidad_no_remota",
  "ciudad_distinta",
  "skills_match_high",
  "title_cap",
  "location_risk",
  "many_candidates",
]);
const PREFILTER_FLAG_PREFIXES = ["domain_keyword:", "title_cap:", `${RESIDENCY_FLAG}:`];

function isPrefilterFlag(flag: string): boolean {
  return PREFILTER_FLAGS.has(flag) || PREFILTER_FLAG_PREFIXES.some((p) => flag.startsWith(p));
}

/** Lo del perfil que mira el prefiltro y que puede cambiar desde «Tu perfil». */
export type PrefilterPrefsSnapshot = Awaited<ReturnType<typeof loadProfilePrefilterPrefs>>;

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** ¿Cambió modalidad, país, ciudad o idioma de las ofertas? (Los puestos no van acá: no se editan en el perfil.) */
export function prefilterPrefsChanged(
  before: PrefilterPrefsSnapshot,
  after: PrefilterPrefsSnapshot,
): boolean {
  return (
    before.country !== after.country ||
    before.city !== after.city ||
    !sameSet(before.acceptedModalities, after.acceptedModalities) ||
    !sameSet(before.jobLanguages, after.jobLanguages)
  );
}

export type ReprefilterResult = {
  examined: number;
  /** Avisos cuyo estado, motivo o banderas cambiaron. */
  changed: number;
  /** Descartados (o nuevos) que ahora pasan. */
  recovered: number;
  /** Que no estaban descartados y ahora quedan `descartada_prefiltro`. */
  discarded: number;
  /** Rescatados con JD que volvieron a la cola de evaluación. */
  enqueued: number;
};

const EMPTY: ReprefilterResult = { examined: 0, changed: 0, recovered: 0, discarded: 0, enqueued: 0 };

export async function reprefilterJobs(
  db: Db,
  userId: string,
  opts: { logger: Logger; now?: () => Date },
): Promise<ReprefilterResult> {
  const now = opts.now?.() ?? new Date();
  const log = opts.logger.child({ user_id: userId });

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`reprefilter:${userId}`}))`);
    // Sin criterios no hay prefiltro posible: no se toca nada (como la asignación del pool)
    const rules = await loadActiveRules(tx, userId);
    if (!rules) return EMPTY;
    const prefs = await loadProfilePrefilterPrefs(tx, userId);

    const rows = await tx
      .select({
        id: s.jobs.id,
        status: s.jobs.status,
        title: s.jobs.title,
        companyRaw: s.jobs.companyRaw,
        locationRaw: s.jobs.locationRaw,
        modality: s.jobs.modality,
        badges: s.jobs.badges,
        candidatesCount: s.jobs.candidatesCount,
        countriesAllowed: s.jobs.countriesAllowed,
        jdText: s.jobs.jdText,
        publicJobId: s.jobs.publicJobId,
        prefilterReason: s.jobs.prefilterReason,
        flags: s.jobs.flags,
      })
      .from(s.jobs)
      .where(and(eq(s.jobs.userId, userId), inArray(s.jobs.status, [...REPREFILTER_STATUSES])))
      .orderBy(desc(s.jobs.firstSeenAt));

    const enqueueEvaluation = enqueueEvaluationWith(tx, createPgQueue(tx));
    const out = { ...EMPTY, examined: rows.length };
    for (const j of rows) {
      const pre = prefilter(
        {
          title: j.title,
          companyRaw: j.companyRaw,
          locationRaw: j.locationRaw,
          modality: j.modality,
          badges: j.badges,
          candidatesCount: j.candidatesCount,
          countriesAllowed: j.countriesAllowed,
          jdText: j.jdText,
          // jobs no guarda `lang`: se detecta del texto, como en la ingesta cuando la fuente no lo trae
          jdLanguage: jdLanguageFor(prefs.jobLanguages, j.jdText),
        },
        rules,
        {
          userCountry: prefs.country,
          remoteOnly: prefs.remoteOnly,
          acceptedModalities: prefs.acceptedModalities,
          userCity: prefs.city,
          jobLanguages: prefs.jobLanguages,
          targetRoles: prefs.targetRoles,
        },
      );

      const kept = (j.flags ?? []).filter((f) => !isPrefilterFlag(f));
      const hasJd = Boolean(j.jdText?.trim());
      const wasOut = j.status === "nueva" || j.status === "descartada_prefiltro";
      let status: JobStatus;
      let flags: string[];
      let reason: string | null;
      if (pre.pass) {
        // Los que ya estaban en carrera conservan su estado; los rescatados entran como en la ingesta
        status = wasOut ? (hasJd ? "prefiltrada" : "pendiente_jd") : j.status;
        flags = [
          ...kept,
          ...pre.flags,
          ...(pre.cap !== null ? [`title_cap:${pre.cap}`] : []),
        ];
        reason = null;
      } else {
        status = "descartada_prefiltro";
        flags = kept;
        reason = `${pre.reason}: ${pre.detail}`;
      }
      flags = [...new Set(flags)];

      const same =
        status === j.status &&
        reason === j.prefilterReason &&
        sameSet(flags, j.flags ?? []);
      if (same) continue;

      await tx
        .update(s.jobs)
        .set({ status, prefilterReason: reason, flags, updatedAt: now })
        .where(and(eq(s.jobs.id, j.id), eq(s.jobs.userId, userId)));
      out.changed++;
      if (pre.pass && wasOut) {
        out.recovered++;
        // Las del pool las encola la asignación diaria con sus propios topes
        if (status === "prefiltrada" && !j.publicJobId && out.enqueued < REPREFILTER_ENQUEUE_CAP) {
          await enqueueEvaluation(j.id, userId);
          out.enqueued++;
        }
      } else if (!pre.pass && j.status !== "descartada_prefiltro") {
        out.discarded++;
      }
    }
    return out;
  });

  log.info(result, "reprefilter: perfil cambiado");
  return result;
}
