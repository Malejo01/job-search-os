import { z } from "zod";
import type { CriteriaRules } from "../criteria";
import type { Decision } from "../decide";
import { EvaluationSchema } from "../evaluation";
import {
  buildChecklist,
  type Checklist,
  type ChecklistContext,
  type ChecklistCounts,
} from "../evaluator/checklist";

/**
 * Checklist al leer (C9-6). Las evaluaciones de antes de la ronda 104 (2026-10-21) no tienen
 * `decision.checklist`: esto lo arma con lo que quedó guardado (el JSON del modelo en `raw` y las
 * columnas de la decisión), el perfil y las skills de hoy. Puro: no lee la base ni llama a ningún
 * LLM, y no guarda nada.
 *
 * Solo la parte determinista: se quitan los ítems cuyo «pide» sale del modelo (modalidad,
 * disciplina, años, inglés, autorización, jornada del modelo) y los de texto, porque se apoyarían
 * en un JSON viejo leído con las reglas de hoy. Lo que queda (país, residencia, salario, jornada de
 * la fuente, skills que nombra el aviso) sale de campos tipados del aviso y del perfil. Siempre
 * `parcial: true`, así la pantalla avisa que la lista está incompleta.
 *
 * Falla cerrado: si `raw` o las columnas no tienen la forma esperada, o `buildChecklist` tira,
 * devuelve null (sin requisitos, como antes). Nunca un checklist a medias con campos inventados.
 */

/** Lo guardado de una evaluación (fila de `evaluations` + `decision.adjustments`). */
export type StoredEvaluation = {
  /** `evaluations.raw`: JSON del modelo ya saneado. Las filas del golden traen otra forma. */
  raw: unknown;
  /** `evaluations.score` (final, tras decide()). */
  score: number;
  /** `evaluations.score_model`; null en filas viejas → se usa el `score` del raw. */
  scoreModel: number | null;
  accion: string;
  bloqueadoresDuros: readonly string[];
  riesgos: readonly string[];
  /** `location_ok` efectivo que guardó decide() (incluye la residencia exigida). */
  locationOk: string;
  hadFullJd: boolean;
  /** `decision.adjustments`; ausente o null = ninguno. */
  adjustments?: unknown;
};

/** Contexto de `buildChecklist` sin `hadFullJd` (sale de la evaluación guardada). */
export type ChecklistOnReadContext = Omit<ChecklistContext, "job"> & {
  job: Omit<ChecklistContext["job"], "hadFullJd">;
};

const storedSchema = z.object({
  score: z.number(),
  scoreModel: z.number().nullable(),
  accion: z.enum(["aplicar_personalizado", "aplicar", "guardar", "descartar"]),
  bloqueadoresDuros: z.array(z.string()),
  riesgos: z.array(z.string()),
  locationOk: z.enum(["ok", "riesgo", "no"]),
  adjustments: z
    .array(z.object({ rule: z.string(), delta: z.number(), detail: z.string() }))
    .nullish()
    .transform((a) => a ?? []),
});

const emptyCounts = (): ChecklistCounts => ({ cumple: 0, no_cumple: 0, no_se_sabe: 0 });

export function checklistOnRead(
  stored: StoredEvaluation,
  rules: CriteriaRules,
  ctx: ChecklistOnReadContext,
): Checklist | null {
  const ev = EvaluationSchema.safeParse(stored.raw);
  if (!ev.success) return null;
  const cols = storedSchema.safeParse(stored);
  if (!cols.success) return null;
  const c = cols.data;

  // Decision mínima con lo guardado: buildChecklist mira bloqueadores, adjustments y locationOk
  const decision: Decision = {
    scoreModel: c.scoreModel ?? ev.data.score,
    scoreFinal: c.score,
    bloqueadores: c.bloqueadoresDuros,
    riesgos: c.riesgos,
    riesgosInformativos: [],
    adjustments: c.adjustments,
    accion: c.accion,
    locationOk: c.locationOk,
  };

  let full: Checklist;
  try {
    full = buildChecklist(ev.data, decision, rules, {
      ...ctx,
      job: { ...ctx.job, hadFullJd: stored.hadFullJd },
    });
  } catch {
    return null;
  }

  const items = full.items.filter((i) => i.fuente.pide !== "modelo" && i.kind !== "texto");
  // Mismo criterio que buildChecklist: las skills nombradas no entran al titular
  const must = emptyCounts();
  const deseable = emptyCounts();
  for (const it of items) {
    if (it.kind === "skill") continue;
    (it.nivel === "must" ? must : deseable)[it.status]++;
  }
  const descarte = full.descarte_rapido;
  return {
    items,
    must,
    deseable,
    parcial: true,
    descarte_rapido: descarte && items.includes(descarte) ? descarte : null,
  };
}
