import type { AgendaRow } from "@job-search-os/pipeline";
import { getMarket, parseRange, type MarketView } from "@/lib/market";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const LEVEL_LABELS = ["nulo", "básico", "productivo", "fuerte"];

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
        <p className="text-xs text-zinc-500">
          {view.weekStart ? `snapshot de la semana del ${view.weekStart}` : "sin snapshots"} ·{" "}
          {view.levelsKnown} skills con nivel propio
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 text-xs text-zinc-600">
        <label className="flex flex-col gap-1">
          Desde (semana)
          <input
            type="date"
            name="desde"
            defaultValue={range.from ?? ""}
            className="rounded-md border border-zinc-300 px-2 py-2 text-sm text-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1">
          Hasta
          <input
            type="date"
            name="hasta"
            defaultValue={range.to ?? ""}
            className="rounded-md border border-zinc-300 px-2 py-2 text-sm text-zinc-800"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-zinc-400 px-3 py-2 text-sm text-zinc-800"
        >
          Aplicar
        </button>
        {view.weeks.length ? (
          <span className="self-center">semanas disponibles: {view.weeks.join(", ")}</span>
        ) : null}
      </form>

      {!view.weekStart ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          No hay snapshot en ese rango. Generalo con <code>pnpm market:snapshot</code> (local:{" "}
          <code>--local</code>).
        </p>
      ) : (
        <>
          <Table
            title="Gaps · demanda alta y nivel ≤ básico"
            hint="Lo que más piden las ofertas que te interesan y hoy no tenés. Orden: demanda ponderada."
            rows={agenda.gaps}
            view={view}
            tone="border-red-200"
          />
          <Table
            title="Diferenciales · nivel fuerte con demanda"
            hint="Lo que ya tenés y el mercado pide: para destacar en la postulación."
            rows={agenda.differentials}
            view={view}
            tone="border-emerald-200"
          />
          <Table
            title="En crecimiento · nivel productivo"
            hint="Productivo pero no fuerte; candidatos a subir con evidencia."
            rows={agenda.growing}
            view={view}
            tone="border-amber-200"
          />
          <details className="rounded-md border border-zinc-200 p-3 text-sm">
            <summary className="cursor-pointer font-semibold">
              Tabla completa ({agenda.all.length} skills)
            </summary>
            <Rows rows={agenda.all} view={view} />
          </details>
          <p className="text-xs text-zinc-500">
            Demanda ponderada = Σ score de la oferta × (1 si es requisito, 0,4 si es deseable). Las
            ofertas sin score pesan 5. Skills mapeadas por alias determinista desde el stack de cada
            aviso (sin LLM); lo que no matchea la taxonomía no cuenta. Niveles autodeclarados
            (`seeds/skill_levels.mauro.json`) hasta la entrevista dirigida.
          </p>
        </>
      )}
    </section>
  );
}

function Table({
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
      <p className="text-xs text-zinc-500">{hint}</p>
      {rows.length ? (
        <Rows rows={rows} view={view} />
      ) : (
        <p className="mt-2 text-xs text-zinc-400">— nada en esta categoría —</p>
      )}
    </section>
  );
}

function Rows({ rows, view }: { rows: AgendaRow[]; view: MarketView }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1 pr-2 font-medium">Skill</th>
            <th className="py-1 pr-2 font-medium">Categoría</th>
            <th className="py-1 pr-2 font-medium">Nivel</th>
            <th className="py-1 pr-2 text-right font-medium">Menciones</th>
            <th className="py-1 pr-2 text-right font-medium">Must</th>
            <th className="py-1 pr-2 text-right font-medium">Demanda</th>
            <th className="py-1 text-right font-medium">Horas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = view.skills[r.slug];
            return (
              <tr key={r.slug} className="border-t border-zinc-100">
                <td className="py-1 pr-2 font-medium text-zinc-900">{k?.name ?? r.slug}</td>
                <td className="py-1 pr-2 text-zinc-600">{k?.category ?? ""}</td>
                <td className="py-1 pr-2 text-zinc-700">
                  {r.level === null ? "sin dato" : `${r.level} · ${LEVEL_LABELS[r.level]}`}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.mentions}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.mustMentions}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.weightedDemand.toFixed(1)}</td>
                <td className="py-1 text-right tabular-nums text-zinc-500">
                  {k?.closureHours ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
