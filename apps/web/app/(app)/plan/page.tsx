import type { PlanStatus } from "@job-search-os/pipeline";
import { getPlan, type PlanItemView } from "@/lib/plan";
import { requireUserId } from "@/lib/session";
import { setPlanStatusAction } from "./actions";

export const dynamic = "force-dynamic";

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
const LEVEL_LABELS = ["nulo", "básico", "productivo", "fuerte"];
const NEXT: Record<PlanStatus, PlanStatus[]> = {
  pendiente: ["en_curso", "cerrada"],
  en_curso: ["cerrada", "pendiente"],
  cerrada: ["pendiente"],
};

/**
 * Plan de formación (JS-034): skills por prioridad = demanda × (1 − nivel/3) × facilidad,
 * con horas estimadas, recurso asociado si hay y estado. Server Component + Server Actions.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await requireUserId();
  const { error } = await searchParams;
  const items = await getPlan(userId);
  const groups: Record<PlanStatus, PlanItemView[]> = { en_curso: [], pendiente: [], cerrada: [] };
  for (const it of items) groups[it.status].push(it);
  const hoursPending = items
    .filter((i) => i.status !== "cerrada")
    .reduce((a, i) => a + (i.hoursRemaining ?? 0), 0);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Plan de formación</h1>
        <p className="text-xs text-zinc-500">
          {items.length} skills · ~{hoursPending} h pendientes
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Estado inválido.
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Sin plan todavía. Generalo con <code>pnpm plan:build</code> (local: <code>--local</code>)
          después de <code>pnpm market:snapshot</code>.
        </p>
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
                          <span className="text-xs font-normal text-zinc-500">{it.category}</span>
                        </p>
                        <p className="text-xs text-zinc-600">
                          prioridad {it.priority.toFixed(1)} · nivel{" "}
                          {it.level === null
                            ? "sin dato"
                            : `${it.level} (${LEVEL_LABELS[it.level]})`}
                          {it.hoursRemaining !== null
                            ? ` · ~${it.hoursRemaining} h para cerrar`
                            : ""}
                          {it.startedAt ? ` · desde ${it.startedAt}` : ""}
                          {it.closedAt ? ` · cerrada ${it.closedAt}` : ""}
                        </p>
                        {it.resource ? (
                          <p className="text-xs">
                            <a
                              href={it.resource.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-sky-700 underline"
                            >
                              {it.resource.title}
                            </a>{" "}
                            <span className="text-zinc-500">
                              · {it.resource.provider}
                              {it.resource.hours ? ` · ${it.resource.hours} h` : ""} · lleva a nivel{" "}
                              {it.resource.targetLevel}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-zinc-400">
                            sin recurso aprobado en el catálogo
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
      <p className="text-xs text-zinc-500">
        Prioridad = demanda ponderada del mercado × (1 − nivel/3) × facilidad (16 h de cierre → 1,
        40 h → 0,4, 80 h → 0,2). Se recalcula con <code>pnpm plan:build</code>; los estados se
        conservan. Recursos: catálogo manual en <code>seeds/learning_resources.json</code>.
      </p>
    </section>
  );
}
