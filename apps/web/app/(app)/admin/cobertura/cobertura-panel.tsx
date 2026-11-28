import {
  COVERAGE_ENTRY_THRESHOLD,
  COVERAGE_TOMABLE_THRESHOLD,
  isRoleKey,
  type CareerCoverageRow,
  type CoverageSemaphore,
} from "@job-search-os/pipeline";
import { careerLabel } from "@/lib/career-market";
import { SOURCE_LABELS } from "@/lib/labels";
import { COBERTURA_TEXTOS as T } from "@/lib/textos-rediseno";

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => String(values[k] ?? m));

/** `computrabajo_alerts` no está en `SOURCE_LABELS`: las ofertas que entran por las casillas del pool. */
const sourceLabel = (kind: string) =>
  kind === "computrabajo_alerts" ? "Computrabajo (alertas)" : (SOURCE_LABELS[kind] ?? kind);

/** Ícono más texto: el estado no depende solo del color. */
const SEMAFORO_ESTILO: Record<CoverageSemaphore, { icon: string; clase: string }> = {
  verde: { icon: "✓", clase: "bg-success-soft text-success" },
  amarillo: { icon: "●", clase: "bg-warning-soft text-warning" },
  rojo: { icon: "✕", clase: "bg-danger-soft text-danger" },
};

function Tendencia({ row }: { row: CareerCoverageRow }) {
  if (!row.trend) {
    return (
      <p className="text-xs text-fg-subtle" data-testid="cobertura-tendencia-vacia">
        {T.tendencia.sinDatos}
      </p>
    );
  }
  const { porDia, ultimos7, previos7 } = row.trend;
  const max = Math.max(1, ...porDia);
  return (
    <div className="flex flex-col gap-1" data-testid="cobertura-tendencia">
      <div
        role="img"
        aria-label={`${T.tendencia.grafico}: ${porDia.join(", ")}`}
        className="flex h-8 items-end gap-0.5"
      >
        {porDia.map((n, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="min-h-px flex-1 rounded-sm bg-brand"
            style={{ height: `${Math.round((n / max) * 100)}%`, opacity: n === 0 ? 0.25 : 1 }}
          />
        ))}
      </div>
      <p className="text-xs text-fg-subtle">
        {fill(T.tendencia.resumen, { nuevas: ultimos7, previas: previos7 })}
      </p>
    </div>
  );
}

/**
 * Panel de cobertura (R32-02): una tarjeta por carrera, sin tablas anchas (390 px sin scroll horizontal).
 * Solo agregados del pool global: ningún aviso ni dato de personas. Server Component sin estado.
 */
export function CoberturaPanel({ rows }: { rows: readonly CareerCoverageRow[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="cobertura-lista">
      {rows.map((r) => {
        const estilo = SEMAFORO_ESTILO[r.semaforo];
        const nombre = isRoleKey(r.role) ? careerLabel(r.role) : r.role;
        return (
          <li
            key={r.role}
            data-testid="cobertura-carrera"
            data-role={r.role}
            data-semaforo={r.semaforo}
            className="flex flex-col gap-3 rounded-card bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-fg">{nombre}</h2>
              <span
                data-testid="cobertura-estado"
                className={`inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-xs font-medium ${estilo.clase}`}
              >
                <span aria-hidden="true">{estilo.icon}</span>
                {T.semaforo[r.semaforo]}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-fg-subtle">{T.columnas.vigentes}</dt>
                <dd data-testid="cobertura-vigentes" className="font-semibold tabular-nums">
                  {r.vigentes}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-subtle">{T.columnas.tomables}</dt>
                <dd data-testid="cobertura-tomables" className="font-semibold tabular-nums">
                  {r.tomables}
                  <span className="font-normal text-fg-subtle">
                    {" "}
                    / {COVERAGE_TOMABLE_THRESHOLD}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-subtle">{T.columnas.paraEmpezar}</dt>
                <dd data-testid="cobertura-empieza" className="font-semibold tabular-nums">
                  {r.paraEmpezar}
                  <span className="font-normal text-fg-subtle"> / {COVERAGE_ENTRY_THRESHOLD}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-subtle">{T.columnas.espanol}</dt>
                <dd data-testid="cobertura-espanol" className="font-semibold tabular-nums">
                  {r.enEspanol}
                </dd>
              </div>
            </dl>
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-fg-subtle">{T.columnas.fuentes}</h3>
              {r.sources.length === 0 ? (
                <p className="text-sm text-fg-muted">{T.fuentes.ninguna}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-fg-muted">
                  {r.sources.map((s) => (
                    <li key={s.source} data-testid="cobertura-fuente" className="break-words">
                      {fill(T.fuentes.detalle, {
                        fuente: sourceLabel(s.source),
                        tomables: s.tomables,
                        vigentes: s.vigentes,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-fg-subtle">{T.columnas.tendencia}</h3>
              <Tendencia row={r} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
