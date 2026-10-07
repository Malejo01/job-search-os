import type { AgendaRow } from "@job-search-os/pipeline";
import type { MarketView } from "@/lib/market";

const LEVEL_LABELS = ["nulo", "básico", "productivo", "fuerte"];

function levelText(level: number | null): string {
  return level === null ? "sin dato" : `${level} · ${LEVEL_LABELS[level]}`;
}

/**
 * Filas de skills: tarjetas apiladas debajo de `sm`, tabla desde `sm`. Dos renders en el server,
 * sin JS de cliente.
 */
export function SkillRows({
  rows,
  view,
  compact = false,
}: {
  rows: AgendaRow[];
  view: MarketView;
  /** En el celular, una línea por skill (para la tabla completa) en vez de tarjeta. */
  compact?: boolean;
}) {
  return (
    <>
      {compact ? (
        <ul className="mt-2 sm:hidden">
          <li
            aria-hidden="true"
            className="flex items-baseline justify-between gap-2 py-1 text-xs text-zinc-600"
          >
            <span className="min-w-0 flex-1">Skill</span>
            <span>Nivel</span>
            <span className="w-12 text-right">Demanda</span>
          </li>
          {rows.map((r) => {
            const k = view.skills[r.slug];
            return (
              <li
                key={r.slug}
                className="flex items-baseline justify-between gap-2 border-t border-zinc-100 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">
                  {k?.name ?? r.slug}
                </span>
                <span className="text-xs text-zinc-600">
                  <span className="sr-only">Nivel: </span>
                  {levelText(r.level)}
                </span>
                <span className="w-12 text-right tabular-nums text-zinc-800">
                  <span className="sr-only">Demanda: </span>
                  {r.weightedDemand.toFixed(1)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ul className="mt-2 flex flex-col gap-2 sm:hidden">
        {(compact ? [] : rows).map((r) => {
          const k = view.skills[r.slug];
          return (
            <li key={r.slug} className="rounded-md border border-zinc-200 bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-zinc-900">{k?.name ?? r.slug}</span>
                <span className="text-xs text-zinc-600">{k?.category ?? ""}</span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-zinc-600">Nivel</dt>
                  <dd className="text-sm font-medium text-zinc-800">{levelText(r.level)}</dd>
                </div>
                <div>
                  <dt className="text-zinc-600">Demanda</dt>
                  <dd className="text-sm font-medium tabular-nums text-zinc-800">
                    {r.weightedDemand.toFixed(1)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-600">Requisito</dt>
                  <dd className="text-sm font-medium text-zinc-800">
                    <span className="tabular-nums">{r.mustMentions}</span> de{" "}
                    <span className="tabular-nums">{r.mentions}</span> avisos
                  </dd>
                </div>
              </dl>
              {k?.closureHours ? (
                <p className="mt-2 text-xs text-zinc-600">Horas para cerrar: {k.closureHours}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-600">
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium">
                Skill
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Categoría
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Nivel
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Menciones
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Must
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Demanda
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Horas
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = view.skills[r.slug];
              return (
                <tr key={r.slug} className="border-t border-zinc-100">
                  <td className="py-1 pr-2 font-medium text-zinc-900">{k?.name ?? r.slug}</td>
                  <td className="py-1 pr-2 text-zinc-600">{k?.category ?? ""}</td>
                  <td className="py-1 pr-2 text-zinc-700">{levelText(r.level)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.mentions}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.mustMentions}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.weightedDemand.toFixed(1)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-zinc-600">
                    {k?.closureHours ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
