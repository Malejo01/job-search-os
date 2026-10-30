import { SELF_LEVELS, type AgendaRow } from "@job-search-os/pipeline";
import { SKILL_CATEGORY_LABEL } from "@/lib/labels";
import type { MarketView } from "@/lib/market";

function levelText(level: number | null): string {
  return level === null ? "sin dato" : `${level} · ${SELF_LEVELS[level]?.label ?? ""}`;
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
            className="flex items-baseline justify-between gap-2 py-1 text-xs text-fg-subtle"
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
                className="flex items-baseline justify-between gap-2 border-t border-line py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {k?.name ?? r.slug}
                </span>
                <span className="text-xs text-fg-subtle">
                  <span className="sr-only">Nivel: </span>
                  {levelText(r.level)}
                </span>
                <span className="w-12 text-right tabular-nums text-fg">
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
            <li key={r.slug} className="rounded-card border border-line bg-surface p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-fg">{k?.name ?? r.slug}</span>
                <span className="text-xs text-fg-subtle">
                  {k ? (SKILL_CATEGORY_LABEL[k.category] ?? k.category) : ""}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-fg-subtle">Nivel</dt>
                  <dd className="text-sm font-medium text-fg">{levelText(r.level)}</dd>
                </div>
                <div>
                  <dt className="text-fg-subtle">Demanda</dt>
                  <dd className="text-sm font-medium tabular-nums text-fg">
                    {r.weightedDemand.toFixed(1)}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-subtle">Excluyente</dt>
                  <dd className="text-sm font-medium text-fg">
                    <span className="tabular-nums">{r.mustMentions}</span> de{" "}
                    <span className="tabular-nums">{r.mentions}</span> avisos
                  </dd>
                </div>
              </dl>
              {k?.closureHours ? (
                <p className="mt-2 text-xs text-fg-subtle">Horas para cerrar: {k.closureHours}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-fg-subtle">
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
                Excluyente
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
                <tr key={r.slug} className="border-t border-line">
                  <td className="py-1 pr-2 font-medium text-fg">{k?.name ?? r.slug}</td>
                  <td className="py-1 pr-2 text-fg-subtle">
                    {k ? (SKILL_CATEGORY_LABEL[k.category] ?? k.category) : ""}
                  </td>
                  <td className="py-1 pr-2 text-fg-muted">{levelText(r.level)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.mentions}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.mustMentions}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.weightedDemand.toFixed(1)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-fg-subtle">
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
