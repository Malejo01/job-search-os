import type { InterviewProgress } from "@job-search-os/pipeline";
import { CRITERIA, formatAverage } from "./copy";

const dateFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

/** «subió 1,2», «bajó 0,5» o «sin cambios»; el signo nunca es lo único que lo dice. */
function changeWord(value: number): string {
  if (value > 0) return `subió ${formatAverage(value)}`;
  if (value < 0) return `bajó ${formatAverage(Math.abs(value))}`;
  return "sin cambios";
}

/**
 * Evolución de los tres puntajes simulación a simulación: una tabla (sin librería de gráficos) con una barrita
 * de CSS decorativa por celda, más lo que cambió entre la primera y la última. Server Component. Solo cuenta
 * simulaciones terminadas; con una sola, invita a hacer otra.
 */
export function ProgressTable({ progress }: { progress: InterviewProgress }) {
  const { points, change } = progress;
  if (points.length === 0) return null;
  return (
    <section
      aria-labelledby="interview-evolucion"
      className="flex flex-col gap-2"
      data-testid="interview-progress"
    >
      <h3 id="interview-evolucion" className="text-base font-extrabold text-fg">
        Cómo venís evolucionando
      </h3>
      {change ? (
        <p className="text-sm text-fg-muted" data-testid="interview-progress-change">
          Desde tu primera simulación:{" "}
          {CRITERIA.map(({ key, label }, i) => (
            <span key={key}>
              {i > 0 ? ", " : ""}
              {label.toLowerCase()} {changeWord(change[key])}
            </span>
          ))}
          .
        </p>
      ) : (
        <p className="text-sm text-fg-muted">
          Con una simulación más vas a ver cómo cambian tus puntajes.
        </p>
      )}
      <div
        role="region"
        aria-labelledby="interview-evolucion"
        tabIndex={0}
        className="overflow-x-auto rounded-control border-2 border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <table className="w-full min-w-[22rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Promedio de cada criterio en tus simulaciones terminadas, de la más vieja a la más nueva
          </caption>
          <thead>
            <tr className="bg-surface-muted text-fg-muted">
              <th scope="col" className="p-2 font-extrabold">
                Fecha
              </th>
              {CRITERIA.map(({ key, label }) => (
                <th key={key} scope="col" className="p-2 font-extrabold">
                  {label}
                </th>
              ))}
              <th scope="col" className="p-2 font-extrabold">
                Promedio
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <th scope="row" className="p-2 font-semibold text-fg">
                  {dateFormat.format(p.at)}
                </th>
                {CRITERIA.map(({ key }) => (
                  <td key={key} className="p-2 text-fg">
                    <span className="font-bold">{formatAverage(p[key])}</span>
                    <span
                      aria-hidden="true"
                      className="mt-1 block h-1.5 rounded-pill bg-surface-muted"
                    >
                      <span
                        className="block h-full rounded-pill bg-brand"
                        style={{ width: `${Math.min(100, Math.max(0, p[key] * 10))}%` }}
                      />
                    </span>
                  </td>
                ))}
                <td className="p-2 font-bold text-fg">{formatAverage(p.overall)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
