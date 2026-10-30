import type { PortalStatsRow } from "@job-search-os/pipeline";

const pct = (n: number, total: number) => `${Math.round((n / total) * 100)} %`;

/**
 * «Qué portal te sirve»: por fuente, cuántas ofertas llegaron en 30 días, cuántas con puntaje ≥ 7,
 * cuántas marcaste como aplicadas y cuántas llegaron a entrevista. Con menos de 5 ofertas dice
 * «pocos datos» y no muestra porcentajes. Tabla desde 640 px; en pantallas chicas, tarjetas.
 */
export function PortalStats({ rows }: { rows: PortalStatsRow[] }) {
  return (
    <section
      data-testid="portal-stats"
      aria-labelledby="portal-stats-title"
      className="flex flex-col gap-3 rounded-control border border-line px-3 py-3"
    >
      <h2 id="portal-stats-title" className="text-base font-semibold text-fg">
        Qué portal te sirve (últimos 30 días)
      </h2>
      {rows.length === 0 ? (
        <p data-testid="portal-stats-empty" className="text-sm text-fg-muted">
          Todavía no hay ofertas en los últimos 30 días
        </p>
      ) : (
        <>
          <table className="hidden w-full text-left text-sm sm:table">
            <caption className="sr-only">
              Ofertas de los últimos 30 días por portal, con puntaje alto, aplicadas y entrevistas
            </caption>
            <thead>
              <tr className="border-b border-line text-fg-subtle">
                <th scope="col" className="py-1 pr-2 font-medium">
                  Portal
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Ofertas
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Puntaje ≥ 7
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Aplicadas
                </th>
                <th scope="col" className="py-1 font-medium">
                  Entrevistas
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.group} data-testid="portal-stats-row" data-group={r.group}>
                  <th scope="row" className="py-1 pr-2 font-medium text-fg">
                    {r.group}
                  </th>
                  <td className="py-1 pr-2" data-testid="portal-stats-total">
                    {r.total}
                  </td>
                  {r.fewData ? (
                    <td colSpan={3} className="py-1 text-fg-subtle" data-testid="portal-stats-few">
                      pocos datos
                    </td>
                  ) : (
                    <>
                      <td className="py-1 pr-2" data-testid="portal-stats-high">
                        {r.highScore} ({pct(r.highScore, r.total)})
                      </td>
                      <td className="py-1 pr-2" data-testid="portal-stats-applied">
                        {r.applied} ({pct(r.applied, r.total)})
                      </td>
                      <td className="py-1" data-testid="portal-stats-interview">
                        {r.interview} ({pct(r.interview, r.total)})
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex list-none flex-col gap-2 p-0 sm:hidden" aria-label="Por portal">
            {rows.map((r) => (
              <li key={r.group} className="rounded-control bg-surface-subtle px-3 py-2 text-sm">
                <p className="font-medium text-fg">
                  {r.group} · {r.total} {r.total === 1 ? "oferta" : "ofertas"}
                </p>
                {r.fewData ? (
                  <p className="text-fg-subtle">pocos datos</p>
                ) : (
                  <p className="text-fg-muted">
                    Puntaje ≥ 7: {r.highScore} ({pct(r.highScore, r.total)}) · Aplicadas:{" "}
                    {r.applied} ({pct(r.applied, r.total)}) · Entrevistas: {r.interview} (
                    {pct(r.interview, r.total)})
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-fg-subtle">
        Cuenta las ofertas que llegaron en los últimos 30 días, según la primera fuente en que
        aparecieron. Como no se guarda el historial de estados, una entrevista que después terminó
        en rechazo no cuenta.
      </p>
    </section>
  );
}
