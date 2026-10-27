import { STUDY_HOURS_DEFAULT, STUDY_HOURS_OPTIONS } from "@job-search-os/pipeline";
import { MAX_SIMULAR, type PlanImpact, type PlanImpactRow } from "@/lib/plan-impact";
import Link from "next/link";

/**
 * «Si aprendés…» (ronda 121, E3b). Server Component sin JS: las skills a simular se eligen con
 * formularios GET (`?simular=a,b`), botones de 44 px con `aria-pressed`. A partir de 640 px es una
 * tabla; en pantallas angostas, la misma información como tarjetas, sin scroll horizontal. Las
 * horas por semana de la ruta (E4b) también van por GET (`?horas=3|5|10`); cada formulario
 * conserva el otro parámetro.
 */

const BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60";

const offers = (n: number) => `${n} ${n === 1 ? "oferta" : "ofertas"}`;

/** «23/10» a partir de un ISO; sin Intl para que no dependa del servidor. */
function shortDate(iso: string): string {
  const [, month, day] = /^\d{4}-(\d{2})-(\d{2})/.exec(iso) ?? [];
  return month && day ? `${day}/${month}` : "";
}

function weeks(from: number, to: number): string {
  return from === to ? `Semana ${from}` : `Semana ${from}-${to}`;
}

/** `?horas=` solo si no es el valor por defecto, para que la URL de siempre siga igual. */
function HoursInput({ hours }: { hours: number }) {
  if (hours === STUDY_HOURS_DEFAULT) return null;
  return <input type="hidden" name="horas" value={hours} />;
}

function PickButton({
  row,
  selected,
  hours,
  testId,
}: {
  row: PlanImpactRow;
  selected: readonly string[];
  hours: number;
  testId: string;
}) {
  const pressed = selected.includes(row.slug);
  const next = pressed ? selected.filter((s) => s !== row.slug) : [...selected, row.slug];
  const full = !pressed && selected.length >= MAX_SIMULAR;
  return (
    <form method="get" action="/plan">
      <input type="hidden" name="simular" value={next.join(",")} />
      <HoursInput hours={hours} />
      <button
        type="submit"
        aria-pressed={pressed}
        disabled={full}
        data-testid={testId}
        className={`${BUTTON} ${
          pressed
            ? "border-info-strong bg-info-strong text-on-strong"
            : "border-line-strong bg-surface text-fg"
        }`}
      >
        Simular {row.name}
      </button>
    </form>
  );
}

/** Selector de horas por semana: un formulario GET por opción, la elegida con `aria-pressed`. */
function HoursPicker({ hours, selected }: { hours: number; selected: readonly string[] }) {
  return (
    <div
      role="group"
      aria-labelledby="plan-horas-titulo"
      className="flex flex-wrap items-center gap-2"
      data-testid="plan-horas"
    >
      <span id="plan-horas-titulo" className="text-xs text-fg-muted">
        Horas por semana:
      </span>
      {STUDY_HOURS_OPTIONS.map((option) => {
        const pressed = option === hours;
        return (
          <form key={option} method="get" action="/plan">
            {selected.length ? (
              <input type="hidden" name="simular" value={selected.join(",")} />
            ) : null}
            <HoursInput hours={option} />
            <button
              type="submit"
              aria-pressed={pressed}
              data-testid={`plan-horas-${option}`}
              className={`${BUTTON} ${
                pressed
                  ? "border-info-strong bg-info-strong text-on-strong"
                  : "border-line-strong bg-surface text-fg"
              }`}
            >
              {option} h
            </button>
          </form>
        );
      })}
    </div>
  );
}

/** E4d: dato del evaluador sobre las ofertas propias. No entra en «+K»: va al lado. */
function EvaluatorGaps({ row, testId }: { row: PlanImpactRow; testId: string }) {
  if (row.evaluatorGaps <= 0) return null;
  return (
    <span data-testid={testId} className="block text-xs font-normal text-fg-muted">
      Al evaluar tus ofertas, esta skill figuró como lo que te falta en {offers(row.evaluatorGaps)}
    </span>
  );
}

/**
 * E3d: «Ver N ofertas», solo con las que ya tenés asignadas. `details` sin JS; cada link de 44 px.
 * Sin ninguna asignada no se muestra nada: la cuenta de «+K» ya está al lado.
 */
function Examples({ row, testId }: { row: PlanImpactRow; testId: string }) {
  if (!row.examples.length) return null;
  return (
    <details className="text-xs" data-testid={testId}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-1 font-medium text-info">
        <span aria-hidden="true">▸</span>
        <span className="underline underline-offset-2">Ver {offers(row.examples.length)}</span>
      </summary>
      <ul className="flex flex-col">
        {row.examples.map((ex) => (
          <li key={ex.jobId}>
            <Link
              href={`/jobs/${ex.jobId}`}
              className="inline-flex min-h-11 items-center break-words text-link underline"
            >
              {ex.title}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Gain({ row }: { row: PlanImpactRow }) {
  return <span className="font-semibold text-success">+{offers(row.delta)}</span>;
}

export function SiAprendes({
  impact,
  selected,
}: {
  impact: PlanImpact | null;
  selected: readonly string[];
}) {
  if (!impact) {
    return (
      <section
        data-testid="plan-sim"
        aria-labelledby="plan-sim-titulo"
        className="flex flex-col gap-2"
      >
        <h2 id="plan-sim-titulo" className="text-sm font-semibold text-fg-muted">
          Si aprendés…
        </h2>
        <p className="text-xs text-fg-subtle">
          No pudimos calcularlo ahora. Probá de nuevo en un rato.
        </p>
      </section>
    );
  }
  if (!impact.enough) {
    return (
      <section
        data-testid="plan-sim"
        aria-labelledby="plan-sim-titulo"
        className="flex flex-col gap-2"
      >
        <h2 id="plan-sim-titulo" className="text-sm font-semibold text-fg-muted">
          Si aprendés…
        </h2>
        <p
          data-testid="plan-sim-pocas"
          className="rounded-control border border-dashed border-line-strong p-4 text-sm text-fg-subtle"
        >
          Con pocas ofertas todavía no podemos calcularlo: cuando haya más avisos de tu carrera vas
          a ver acá cuántos se te abren con cada skill.
        </p>
      </section>
    );
  }

  const names = new Map(impact.rows.map((r) => [r.slug, r.name]));
  const sim = impact.simulation;
  const hours = impact.hoursPerWeek;

  return (
    <section
      data-testid="plan-sim"
      aria-labelledby="plan-sim-titulo"
      className="flex flex-col gap-3"
    >
      <h2 id="plan-sim-titulo" className="text-sm font-semibold text-fg-muted">
        Si aprendés…
      </h2>
      <p className="text-xs text-fg-subtle" data-testid="plan-sim-hoy">
        Hoy te calzan {impact.passNow} de {impact.total} ofertas. Mirá cuántas más te calzarían si
        llevás una skill a nivel 2. Podés elegir hasta {MAX_SIMULAR} para ver el total junto.
      </p>

      {sim ? (
        <p
          role="status"
          data-testid="plan-sim-resultado"
          className="rounded-control border border-info-line bg-info-soft px-3 py-2 text-sm text-info"
        >
          Con {sim.slugs.map((slug) => names.get(slug) ?? slug).join(", ")} pasan{" "}
          <strong>
            {sim.passAfter} de {sim.total}
          </strong>{" "}
          ofertas (hoy pasan {sim.passNow}).{" "}
          <Link
            href={hours === STUDY_HOURS_DEFAULT ? "/plan" : `/plan?horas=${hours}`}
            className="inline-flex min-h-11 items-center underline"
          >
            Limpiar la simulación
          </Link>
        </p>
      ) : null}

      <table className="hidden w-full text-left text-sm sm:table" data-testid="plan-sim-tabla">
        <caption className="pb-2 text-left text-xs text-fg-subtle">
          Ofertas que te empezarían a calzar al aprender cada skill del plan
        </caption>
        <thead>
          <tr className="border-b border-line text-xs text-fg-muted">
            <th scope="col" className="py-2 pr-3 font-semibold">
              Skill
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              La piden
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              Hoy → con la skill
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              Suma
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              Horas
            </th>
            <th scope="col" className="py-2 font-semibold">
              Simular
            </th>
          </tr>
        </thead>
        <tbody>
          {impact.rows.map((row) => (
            <tr
              key={row.slug}
              data-testid={`plan-sim-fila-${row.slug}`}
              className="border-b border-line"
            >
              <th scope="row" className="py-2 pr-3 font-medium text-fg">
                {row.name}
              </th>
              <td className="py-2 pr-3 text-fg-muted">
                {row.asks} ({row.asksMust} excluyente{row.asksMust === 1 ? "" : "s"})
                <EvaluatorGaps row={row} testId={`plan-sim-evaluador-${row.slug}`} />
              </td>
              <td className="py-2 pr-3 text-fg-muted">
                {row.passNow} → {row.passAfter}
              </td>
              <td className="py-2 pr-3">
                <Gain row={row} />
                <Examples row={row} testId={`plan-sim-ejemplos-${row.slug}`} />
              </td>
              <td className="py-2 pr-3 text-fg-muted">
                ~{row.hours} h{row.estimated ? " (estimado)" : ""}
              </td>
              <td className="py-1">
                <PickButton
                  row={row}
                  selected={selected}
                  hours={hours}
                  testId={`plan-sim-pick-${row.slug}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col gap-2 sm:hidden" data-testid="plan-sim-tarjetas">
        {impact.rows.map((row) => (
          <li
            key={row.slug}
            data-testid={`plan-sim-tarjeta-${row.slug}`}
            className="flex flex-col gap-1 rounded-card border border-line bg-surface p-3 text-sm"
          >
            <p className="break-words font-medium text-fg">{row.name}</p>
            <EvaluatorGaps row={row} testId={`plan-sim-evaluador-m-${row.slug}`} />
            <p className="text-xs text-fg-muted">
              La piden {row.asks} ({row.asksMust} excluyente{row.asksMust === 1 ? "" : "s"})
            </p>
            <p className="text-xs text-fg-muted">
              Hoy te calzan {row.passNow}; con la skill, {row.passAfter}
            </p>
            <p className="text-xs">
              <Gain row={row} />
            </p>
            <Examples row={row} testId={`plan-sim-ejemplos-m-${row.slug}`} />
            <p className="text-xs text-fg-muted">
              ~{row.hours} h{row.estimated ? " (estimado)" : ""}
            </p>
            <PickButton
              row={row}
              selected={selected}
              hours={hours}
              testId={`plan-sim-pick-m-${row.slug}`}
            />
          </li>
        ))}
      </ul>

      {impact.route.length ? (
        <section aria-labelledby="plan-ruta-titulo" className="flex flex-col gap-2">
          <h3 id="plan-ruta-titulo" className="text-sm font-semibold text-fg-muted">
            Ruta por semanas
          </h3>
          {impact.hoursAdjustable ? <HoursPicker hours={hours} selected={selected} /> : null}
          <ol className="flex flex-col gap-1" data-testid="plan-ruta">
            {impact.route.map((step) => (
              <li
                key={step.slug}
                className="break-words rounded-control border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="font-medium">{weeks(step.weekFrom, step.weekTo)}</span> ·{" "}
                {step.name} · {step.hours} h{step.estimated ? " estimadas" : ""} · suma{" "}
                {offers(step.delta)}
              </li>
            ))}
          </ol>
          <p className="text-xs text-fg-subtle" data-testid="plan-ruta-pie">
            Con {hours} h por semana. Ofertas de los últimos 30 días, al{" "}
            {shortDate(impact.poolDate)}.
          </p>
        </section>
      ) : null}
    </section>
  );
}
