import {
  SELF_LEVELS,
  pickWeekFocus,
  type PlanStatus,
  type WeekFocus,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { SKILL_CATEGORY_LABEL, safeHttpUrl } from "@/lib/labels";
import { getTargetRoles } from "@/lib/onboarding";
import { getDataState, getOwnJobsPlanState, getPlan, type PlanItemView } from "@/lib/plan";
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
  pendiente: "bg-surface-muted text-fg-muted",
  en_curso: "bg-warning-muted text-warning",
  cerrada: "bg-success-muted text-success",
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

/** «Empezar», «Cerrar» o «Reabrir» según el estado: los mismos en la lista y en «Esta semana». */
function StatusButtons({ item }: { item: PlanItemView }) {
  return NEXT[item.status].map((next) => (
    <form key={next} action={setPlanStatusAction}>
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="status" value={next} />
      <button
        type="submit"
        className="rounded-control border border-line-strong px-2 py-1 text-xs text-fg-muted"
      >
        {next === "en_curso" ? "Empezar" : next === "cerrada" ? "Cerrar" : "Reabrir"}
      </button>
    </form>
  ));
}

/**
 * «Esta semana» (121 §4.1, E4c): la skill de la ruta en la que conviene estar ahora, con las horas
 * de la semana, el recurso y los botones de siempre. Solo con ruta: sin ella no hay qué proponer.
 */
function EstaSemana({ focus, item }: { focus: WeekFocus; item: PlanItemView | undefined }) {
  const href = item?.resource ? safeHttpUrl(item.resource.url) : null;
  return (
    <section
      data-testid="plan-semana"
      aria-labelledby="plan-semana-titulo"
      className="flex flex-col gap-2 rounded-card border border-info-line bg-info-soft p-3"
    >
      <h2 id="plan-semana-titulo" className="text-sm font-semibold text-info">
        Esta semana
      </h2>
      <p className="break-words text-sm font-medium text-fg">{focus.step.name}</p>
      <p className="text-xs text-fg-muted" data-testid="plan-semana-horas">
        {focus.hoursThisWeek} h esta semana · te quedan {focus.hoursLeft} h
        {focus.step.estimated ? " (estimado)" : ""}
      </p>
      {item?.resource && href ? (
        <p className="text-xs">
          <a href={href} target="_blank" rel="noreferrer noopener" className="text-link underline">
            {item.resource.title}
          </a>{" "}
          <span className="text-fg-muted">· {item.resource.provider}</span>
        </p>
      ) : (
        <p className="text-xs text-fg-muted">Todavía no tenemos un curso para esta skill.</p>
      )}
      {item ? (
        <div className="flex flex-wrap items-center gap-1">
          <StatusButtons item={item} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Plan de formación (JS-034): skills por prioridad = demanda × (1 − nivel/3) × facilidad,
 * con horas estimadas, recurso asociado si hay y estado. Server Component + Server Actions.
 * Con varios puestos (ronda 45) el plan sigue siendo uno: un plan por puesto es un ticket futuro.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    simular?: string | string[];
    horas?: string | string[];
  }>;
}) {
  const userId = await requireUserId();
  const { error, simular, horas } = await searchParams;
  // El plan guardado es uno por persona: la nota usa siempre el puesto principal
  const role = (await getTargetRoles(userId))[0] ?? null;
  const [items, state, { roleFallback, fewOwnJobs }] = await Promise.all([
    getPlan(userId),
    getDataState(userId),
    getOwnJobsPlanState(userId, role),
  ]);
  // El simulador necesita plan y niveles cargados; sin ellos la pantalla ya explica qué falta
  const showSim = items.length > 0 && state.levelsKnown > 0;
  const impact = showSim ? await getPlanImpact(userId, role, new Date(), simular, horas) : null;
  const maxPriority = items.reduce((m, i) => Math.max(m, i.priority), 0);
  const groups: Record<PlanStatus, PlanItemView[]> = { en_curso: [], pendiente: [], cerrada: [] };
  for (const it of items) groups[it.status].push(it);
  const hoursPending = items
    .filter((i) => i.status !== "cerrada")
    .reduce((a, i) => a + (i.hoursRemaining ?? 0), 0);
  // Los estados salen de la base, no del caché del impacto: un «Empezar» se ve en el acto. Y solo
  // cuentan los pasos que siguen en el plan (la ruta puede tener hasta 30 minutos)
  const planSlugs = new Set(items.map((i) => i.slug));
  const focus = impact?.enough
    ? pickWeekFocus(
        impact.route.filter((step) => planSlugs.has(step.slug)),
        new Map(items.map((i) => [i.slug, i.status])),
        impact.hoursPerWeek,
      )
    : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-title font-semibold">Plan de formación</h1>
        <p className="text-xs text-fg-subtle">
          {items.length} {items.length === 1 ? "skill" : "skills"} ·{" "}
          {hoursPending > 0 ? `~${hoursPending} h pendientes` : "horas sin estimar"}
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          No pudimos cambiar el estado de esa skill. Probá de nuevo.
        </p>
      ) : null}
      {roleFallback && items.length > 0 ? (
        <p data-testid="plan-role-source" className="text-xs text-fg-subtle">
          Calculado con el mercado de {roleFallback}: cuando tengas 10 ofertas propias, pasa a usar
          las tuyas.
        </p>
      ) : null}
      <Link
        href="/encaje"
        className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-link underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        Ver Tu encaje: qué piden tus ofertas y qué te falta
      </Link>
      <NoLevelsNotice state={state} />
      {focus ? (
        <EstaSemana focus={focus} item={items.find((i) => i.slug === focus.step.slug)} />
      ) : null}
      {items.length === 0 ? (
        state.hasSnapshot ? (
          fewOwnJobs ? (
            <EmptyState data-testid="plan-few-offers" action={null}>
              <p>
                Con pocas ofertas todavía no podemos armar tu plan: sumá más o{" "}
                <Link href="/jobs/new" className="underline">
                  pegá una oferta
                </Link>
                .
              </p>
            </EmptyState>
          ) : (
            <EmptyState action={null}>
              <p>
                No hay skills para reforzar con las ofertas actuales. Cuando sumes más ofertas o
                cambies tus niveles en{" "}
                <Link href="/settings/skills" className="underline">
                  Mis skills
                </Link>
                , se actualiza.
              </p>
            </EmptyState>
          )
        ) : (
          <MissingDataNotice state={state} />
        )
      ) : (
        (["en_curso", "pendiente", "cerrada"] as const).map((status) =>
          groups[status].length ? (
            <section key={status} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-fg-muted">
                {STATUS_LABELS[status]} ({groups[status].length})
              </h2>
              <ol className="flex flex-col gap-2">
                {groups[status].map((it) => (
                  <li key={it.id} className="rounded-card border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">
                          {it.name}{" "}
                          <span className="text-xs font-normal text-fg-subtle">
                            {SKILL_CATEGORY_LABEL[it.category] ?? it.category}
                          </span>
                        </p>
                        <p className="text-xs text-fg-subtle">
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
                              className="text-link underline"
                            >
                              {it.resource.title}
                            </a>{" "}
                            <span className="text-fg-subtle">
                              · {it.resource.provider}
                              {it.resource.hours ? ` · ${it.resource.hours} h` : ""} · lleva a nivel{" "}
                              {it.resource.targetLevel}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-fg-subtle">
                            Todavía no tenemos un curso para esta skill. Estamos sumando
                            proveedores.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className={`rounded-badge px-1.5 py-0.5 text-[11px] ${STATUS_CLASSES[it.status]}`}
                        >
                          {STATUS_LABELS[it.status]}
                        </span>
                        <StatusButtons item={it} />
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
      <details className="rounded-control border border-line p-3 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Cómo se calcula
        </summary>
        <p className="mt-2 text-xs text-fg-subtle">
          La prioridad sube cuando una skill se pide mucho, tu nivel es bajo y se aprende rápido
          (menos horas). «Alta», «media» y «baja» comparan cada skill con la de mayor prioridad de
          tu plan. Se recalcula cuando guardás tus skills y cada lunes; los estados que marcaste se
          conservan. Los recursos salen de un catálogo revisado a mano.
        </p>
        <p className="mt-2 text-xs text-fg-subtle">
          «Si aprendés…» cuenta una oferta como «te calza» cuando su puntaje estimado llega a 7 de
          10, el mismo corte que usa «Hoy». Es una cuenta rápida de cuántas de las skills que piden
          ya manejás, sin leer la oferta entera. Aprender una skill es llevarla a nivel 2. No es el
          puntaje de la evaluación: ese puede ser otro.
        </p>
      </details>
    </section>
  );
}
