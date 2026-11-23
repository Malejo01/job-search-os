import {
  USAGE_K,
  USAGE_NO_CAREER_KEY,
  USAGE_WEEKS,
  isRoleKey,
  type UsageCell,
  type UsageMetric,
} from "@job-search-os/pipeline";
import { careerLabel } from "@/lib/career-market";
import type { UsageByCareerResult } from "@/lib/usage-by-career";

const NUMBER = new Intl.NumberFormat("es-AR");

const th = "pb-1 pl-2 text-right font-normal";

/** Encabezados de columna: texto corto a la vista y el nombre completo para lectores de pantalla. */
const COLUMNS: { metric: UsageMetric; short: string; full: string }[] = [
  { metric: "active", short: "Activas", full: "Personas activas" },
  { metric: "evaluated", short: "Evaluadas", full: "Ofertas evaluadas" },
  { metric: "up", short: "👍", full: "Opiniones de acuerdo" },
  { metric: "down", short: "👎", full: "Opiniones en desacuerdo" },
  { metric: "applications", short: "Postul.", full: "Postulaciones marcadas" },
  { metric: "interviews", short: "Simul.", full: "Simulaciones de Interview" },
  { metric: "coach_chats", short: "Charlas", full: "Charlas del coach" },
  { metric: "cv_reviews", short: "CV", full: "Diagnósticos del CV" },
];

/** «2026-11-16» → «16/11» (la fecha ya viene en hora de Buenos Aires: no se pasa por Date). */
function weekLabel(week: string): string {
  const [, month, day] = week.split("-");
  return `${Number(day)}/${Number(month)}`;
}

function nameOf(career: string): string {
  if (career === USAGE_NO_CAREER_KEY) return "Sin carrera";
  return isRoleKey(career) ? careerLabel(career) : career;
}

function Cell({ cell }: { cell: UsageCell }) {
  return (
    <td className="py-1 pl-2 text-right tabular-nums">
      {cell.kind === "value" ? (
        NUMBER.format(cell.value)
      ) : (
        <span className="text-fg-subtle">
          <span aria-hidden="true">&lt;{USAGE_K}</span>
          <span className="sr-only">menos de {USAGE_K}</span>
        </span>
      )}
    </td>
  );
}

/**
 * Uso por carrera y por semana (R22-04): personas activas, ofertas evaluadas, 👍/👎, postulaciones, simulaciones
 * de Interview, charlas del coach y diagnósticos del CV, de las últimas {USAGE_WEEKS} semanas (lunes a domingo, hora
 * de Buenos Aires; la última está en curso). Solo agregados: una celda con menos de {USAGE_K} personas aparece
 * como «menos de {USAGE_K}», también cuando no hubo actividad. Server Component sin estado; cada carrera es un
 * `<details>` y la tabla scrollea sola si no entra en 390 px.
 */
export function UsageByCareerPanel({ result }: { result: UsageByCareerResult }) {
  if (!result.ok) {
    const text =
      result.reason === "no_habilitado"
        ? "Uso por carrera: tu cuenta todavía no está habilitada en la base (app_admins)."
        : "Uso por carrera: no se pudieron leer los datos (¿falta aplicar la migración de la base?).";
    return (
      <p role="status" className="rounded-card bg-surface p-4 text-sm">
        {text}
      </p>
    );
  }
  const { weeks, careers } = result.grid;
  // La más reciente arriba
  const newestFirst = [...weeks].reverse();
  return (
    <section
      aria-labelledby="uso-por-carrera"
      className="flex flex-col gap-3 rounded-card bg-surface p-4"
      data-testid="uso-por-carrera"
    >
      <div className="flex flex-col gap-1">
        <h2 id="uso-por-carrera" className="font-medium">
          Uso por carrera y por semana
        </h2>
        <p className="text-xs text-fg-subtle break-words">
          Últimas {USAGE_WEEKS} semanas (lunes a domingo; la primera fila está en curso). Cada celda
          es un número de acciones; con menos de {USAGE_K} personas distintas aparece como «&lt;
          {USAGE_K}», y ahí no se dice cuántas hubo ni si hubo. <strong>Activas</strong> = personas
          que hicieron algo a mano: 👍/👎, postulación, oferta cargada, simulación, charla del coach
          o diagnóstico del CV; las evaluaciones automáticas no cuentan. <strong>Evaluadas</strong>{" "}
          incluye las que corre el sistema solo. Una charla que cruza dos semanas cuenta en cada
          una. La carrera es la primera que eligió cada persona; sin carrera válida va a «Sin
          carrera». No hay total entre carreras ni cuentas de prueba.
        </p>
      </div>
      {careers.length === 0 ? (
        <p className="text-sm text-fg-muted" data-testid="uso-por-carrera-vacio">
          Todavía ninguna carrera tiene {USAGE_K} personas activas en una misma semana.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {careers.map((c) => (
            <li
              key={c.career}
              data-testid="uso-carrera"
              data-role={c.career}
              className="border-t border-line pt-2"
            >
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-fg">
                  {nameOf(c.career)}
                </summary>
                <div
                  className="overflow-x-auto"
                  role="region"
                  tabIndex={0}
                  aria-label={`Uso semanal: ${nameOf(c.career)}`}
                >
                  <table className="w-full min-w-[34rem] text-xs">
                    <thead>
                      <tr className="text-fg-subtle">
                        <th scope="col" className="pb-1 text-left font-normal">
                          Semana del
                        </th>
                        {COLUMNS.map((col) => (
                          <th key={col.metric} scope="col" className={th}>
                            <span aria-hidden="true">{col.short}</span>
                            <span className="sr-only">{col.full}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {newestFirst.map((week) => (
                        <tr key={week} className="border-t border-line">
                          <th scope="row" className="py-1 text-left font-normal text-fg-muted">
                            {weekLabel(week)}
                          </th>
                          {COLUMNS.map((col) => (
                            <Cell key={col.metric} cell={c.cells[week]![col.metric]} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
