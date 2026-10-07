import type { AgendaRow } from "@job-search-os/pipeline";
import { getMarket, parseRange, type MarketView } from "@/lib/market";
import { requireUserId } from "@/lib/session";
import { SkillCandidates } from "./skill-candidates";
import { SkillRows } from "./skill-rows";

export const dynamic = "force-dynamic";

const INPUT_CLASS =
  "w-full rounded-md border border-zinc-300 px-2 py-2 text-sm text-zinc-800 sm:w-auto";

/**
 * Agenda de mercado (adelanto de JS-031, sin LLM): qué piden las ofertas que ya pasaron por el
 * sistema, ponderado por score (Σ score × must ? 1 : 0.4), cruzado con el nivel propio.
 * Server Component; la única interactividad es el rango de semanas (formulario GET).
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const range = parseRange(await searchParams);
  const view = await getMarket(userId, range);
  const { agenda } = view;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Mercado</h1>
        <p className="text-xs text-zinc-600">
          {view.weekStart ? `snapshot de la semana del ${view.weekStart}` : "sin snapshots"} ·{" "}
          {view.levelsKnown} skills con nivel propio
        </p>
      </div>

      <form method="get" className="flex flex-col gap-2 text-xs text-zinc-600">
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1">
            Desde (semana)
            <input
              type="date"
              name="desde"
              defaultValue={range.from ?? ""}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={range.to ?? ""} className={INPUT_CLASS} />
          </label>
          <button
            type="submit"
            className="min-h-11 w-full rounded-md border border-zinc-400 px-4 py-2 text-sm text-zinc-800 sm:w-auto"
          >
            Aplicar
          </button>
        </div>
        {view.weeks.length ? <p>semanas disponibles: {view.weeks.join(", ")}</p> : null}
      </form>

      {!view.weekStart ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
          No hay snapshot en ese rango. Generalo con <code>pnpm market:snapshot</code> (local:{" "}
          <code>--local</code>).
        </p>
      ) : (
        <>
          <Section
            title="Gaps · demanda alta y nivel ≤ básico"
            hint="Lo que más piden las ofertas que te interesan y hoy no tenés. Orden: demanda ponderada."
            rows={agenda.gaps}
            view={view}
            tone="border-red-200"
          />
          <Section
            title="Diferenciales · nivel fuerte con demanda"
            hint="Lo que ya tenés y el mercado pide: para destacar en la postulación."
            rows={agenda.differentials}
            view={view}
            tone="border-emerald-200"
          />
          <Section
            title="En crecimiento · nivel productivo"
            hint="Productivo pero no fuerte; candidatos a subir con evidencia."
            rows={agenda.growing}
            view={view}
            tone="border-amber-200"
          />
          <details className="rounded-md border border-zinc-200 p-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
              Tabla completa ({agenda.all.length} skills)
            </summary>
            <SkillRows rows={agenda.all} view={view} compact />
          </details>
          <SkillCandidates candidates={view.candidates} />
          <details className="rounded-md border border-zinc-200 p-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
              ¿Cómo se calcula?
            </summary>
            <p className="mt-2 text-xs text-zinc-600">
              Demanda ponderada = Σ score de la oferta × (1 si es requisito, 0,4 si es deseable).
              Las ofertas sin score pesan 5. Skills mapeadas por alias determinista desde el stack
              de cada aviso (sin LLM); lo que no matchea la taxonomía no cuenta. Niveles
              autodeclarados (`seeds/skill_levels.mauro.json`) hasta la entrevista dirigida.
            </p>
          </details>
        </>
      )}
    </section>
  );
}

function Section({
  title,
  hint,
  rows,
  view,
  tone,
}: {
  title: string;
  hint: string;
  rows: AgendaRow[];
  view: MarketView;
  tone: string;
}) {
  return (
    <section className={`rounded-md border p-3 ${tone}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-zinc-600">{hint}</p>
      {rows.length ? (
        <SkillRows rows={rows} view={view} />
      ) : (
        <p className="mt-2 text-xs text-zinc-600">— nada en esta categoría —</p>
      )}
    </section>
  );
}
