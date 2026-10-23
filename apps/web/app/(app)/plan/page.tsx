import { SELF_LEVELS, type PlanStatus } from "@job-search-os/pipeline";
import Link from "next/link";
import { SKILL_CATEGORY_LABEL, safeHttpUrl } from "@/lib/labels";
import { getTargetRoles } from "@/lib/onboarding";
import {
  getDataState,
  getPlan,
  getPlanRoleFallback,
  hasFewOwnJobs,
  type PlanItemView,
} from "@/lib/plan";
import { getPlanImpact } from "@/lib/plan-impact";
import { requireUserId } from "@/lib/session";
import { MissingDataNotice, NoLevelsNotice } from "../market/data-state-notice";
import { setPlanStatusAction } from "./actions";
import { SiAprendes } from "./si-aprendes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan" };

const STATUS_LABELS: Record<PlanStatus, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  cerrada: "Cerrada",
};
const STATUS_CLASSES: Record<PlanStatus, string> = {
  pendiente: "bg-zinc-100 text-zinc-700",
  en_curso: "bg-amber-100 text-amber-900",
  cerrada: "bg-emerald-100 text-emerald-900",
};
const NEXT: Record<PlanStatus, PlanStatus[]> = {
  pendiente: ["en_curso", "cerrada"],
  en_curso: ["cerrada", "pendiente"],
  cerrada: ["pendiente"],
};

/**
 * Prioridad en palabras (ronda 45): el número depende de la escala de demanda de cada persona y
 * no dice nada solo. Se compara con el ítem de mayor prioridad del plan: desde 2/3 de ese máximo es
 * «alta», desde 1/3 «media» y por debajo «baja». Con un solo ítem, o sin prioridad, es «alta».
 */
function priorityBand(priority: number, max: number): "alta" | "media" | "baja" {
  if (max <= 0) return "alta";
  const ratio = priority / max;
  return ratio >= 2 / 3 ? "alta" : ratio >= 1 / 3 ? "media" : "baja";
}

/**
 * Plan de formación (JS-034): skills por prioridad = demanda × (1 − nivel/3) × facilidad,
 * con horas estimadas, recurso asociado si hay y estado. Server Component + Server Actions.
 * Con varios puestos (ronda 45) el plan sigue siendo uno: un plan por puesto es un ticket futuro.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; simular?: string | string[] }>;
}) {
  const userId = await requireUserId();
  const { error, simular } = await searchParams;
  // El plan guardado es uno por persona: la nota usa siempre el puesto principal
  const role = (await getTargetRoles(userId))[0] ?? null;
  const [items, state, roleFallback, fewOwnJobs] = await Promise.all([
    getPlan(userId),
    getDataState(userId),
    getPlanRoleFallback(userId, role),
    hasFewOwnJobs(userId),
  ]);
  // El simulador necesita plan y niveles cargados; sin ellos la pantalla ya explica qué falta
  const showSim = items.length > 0 && state.levelsKnown > 0;
  const impact = showSim ? await getPlanImpact(userId, role, new Date(), simular) : null;
  const maxPriority = items.reduce((m, i) => Math.max(m, i.priority), 0);
  const groups: Record<PlanStatus, PlanItemView[]> = { en_curso: [], pendiente: [], cerrada: [] };
  for (const it of items) groups[it.status].push(it);
  const hoursPending = items
    .filter((i) => i.status !== "cerrada")
    .reduce((a, i) => a + (i.hoursRemaining ?? 0), 0);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Plan de formación</h1>
        <p className="text-xs text-zinc-600">
          {items.length} skills ·{" "}
          {hoursPending > 0 ? `~${hoursPending} h pendientes` : "horas sin estimar"}
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Estado inválido.
        </p>
      ) : null}
      {roleFallback && items.length > 0 ? (
        <p data-testid="plan-role-source" className="text-xs text-zinc-600">
          Calculado con el mercado de {roleFallback}: cuando tengas 10 ofertas propias, pasa a usar
          las tuyas.
        </p>
      ) : null}
      <Link
        href="/encaje"
        className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
      >
        Ver Tu encaje: qué piden tus ofertas y qué te falta
      </Link>
      <NoLevelsNotice state={state} />
      {items.length === 0 ? (
        state.hasSnapshot ? (
          fewOwnJobs ? (
            <p
              data-testid="plan-few-offers"
              className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600"
            >
              Con pocas ofertas todavía no podemos decirlo: sumá más o{" "}
              <Link href="/jobs/new" className="underline">
                pegá una oferta
              </Link>
              .
            </p>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
              No hay skills para reforzar con las ofertas actuales.
            </p>
          )
        ) : (
          <MissingDataNotice state={state} />
        )
      ) : (
        (["en_curso", "pendiente", "cerrada"] as const).map((status) =>
          groups[status].length ? (
            <section key={status} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-zinc-700">
                {STATUS_LABELS[status]} ({groups[status].length})
              </h2>
              <ol className="flex flex-col gap-2">
                {groups[status].map((it) => (
                  <li key={it.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900">
                          {it.name}{" "}
                          <span className="text-xs font-normal text-zinc-600">
                            {SKILL_CATEGORY_LABEL[it.category] ?? it.category}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-600">
                          prioridad {priorityBand(it.priority, maxPriority)} · nivel{" "}
                          {it.level === null
                            ? "sin dato"
                            : `${it.level} (${SELF_LEVELS[it.level]?.label ?? ""})`}
                          {it.hoursRemaining
                            ? ` · ~${it.hoursRemaining} h para cerrar`
                            : " · horas sin estimar"}
                          {it.startedAt ? ` · desde ${it.startedAt}` : ""}
                          {it.closedAt ? ` · cerrada ${it.closedAt}` : ""}
                        </p>
                        {it.resource ? (
                          <p className="text-xs">
                            <a
                              href={safeHttpUrl(it.resource.url) ?? undefined}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-sky-700 underline"
                            >
                              {it.resource.title}
                            </a>{" "}
                            <span className="text-zinc-600">
                              · {it.resource.provider}
                              {it.resource.hours ? ` · ${it.resource.hours} h` : ""} · lleva a nivel{" "}
                              {it.resource.targetLevel}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-zinc-600">
                            Todavía no tenemos un curso para esta skill
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_CLASSES[it.status]}`}
                        >
                          {STATUS_LABELS[it.status]}
                        </span>
                        {NEXT[it.status].map((next) => (
                          <form key={next} action={setPlanStatusAction}>
                            <input type="hidden" name="itemId" value={it.id} />
                            <input type="hidden" name="status" value={next} />
                            <button
                              type="submit"
                              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700"
                            >
                              {next === "en_curso"
                                ? "Empezar"
                                : next === "cerrada"
                                  ? "Cerrar"
                                  : "Reabrir"}
                            </button>
                          </form>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null,
        )
      )}
      {showSim ? <SiAprendes impact={impact} selected={impact?.simulation?.slugs ?? []} /> : null}
      <details className="rounded-md border border-zinc-200 p-3 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Cómo se calcula
        </summary>
        <p className="mt-2 text-xs text-zinc-600">
          Prioridad = demanda ponderada del mercado × (1 − nivel/3) × facilidad (16 h de cierre → 1,
          40 h → 0,4, 80 h → 0,2). «Alta», «media» y «baja» comparan cada skill con la de mayor
          prioridad de tu plan. Se recalcula cuando guardás tus skills y cada lunes; los estados que
          marcaste se conservan. Los recursos salen de un catálogo revisado a mano.
        </p>
        <p className="mt-2 text-xs text-zinc-600">
          «Si aprendés…» cuenta una oferta como «te calza» cuando su pre-score (una cuenta rápida de
          cuántas de las skills que piden ya manejás, sin leer la oferta entera) llega a 7, el mismo
          corte que usa «Hoy». Aprender una skill es llevarla a nivel 2. Ese número no es el puntaje
          del modelo: es una estimación más gruesa, y el puntaje de cada oferta puede ser otro.
        </p>
      </details>
    </section>
  );
}
