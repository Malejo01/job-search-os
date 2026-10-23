import { MAX_SIMULAR, type PlanImpact, type PlanImpactRow } from "@/lib/plan-impact";
import Link from "next/link";

/**
 * «Si aprendés…» (ronda 121, E3b). Server Component sin JS: las skills a simular se eligen con
 * formularios GET (`?simular=a,b`), botones de 44 px con `aria-pressed`. A partir de 640 px es una
 * tabla; en pantallas angostas, la misma información como tarjetas, sin scroll horizontal.
 */

const BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-60";

const offers = (n: number) => `${n} ${n === 1 ? "oferta" : "ofertas"}`;

/** «23/10» a partir de un ISO; sin Intl para que no dependa del servidor. */
function shortDate(iso: string): string {
  const [, month, day] = /^\d{4}-(\d{2})-(\d{2})/.exec(iso) ?? [];
  return month && day ? `${day}/${month}` : "";
}

function weeks(from: number, to: number): string {
  return from === to ? `Semana ${from}` : `Semana ${from}-${to}`;
}

function PickButton({
  row,
  selected,
  testId,
}: {
  row: PlanImpactRow;
  selected: readonly string[];
  testId: string;
}) {
  const pressed = selected.includes(row.slug);
  const next = pressed ? selected.filter((s) => s !== row.slug) : [...selected, row.slug];
  const full = !pressed && selected.length >= MAX_SIMULAR;
  return (
    <form method="get" action="/plan">
      <input type="hidden" name="simular" value={next.join(",")} />
      <button
        type="submit"
        aria-pressed={pressed}
        disabled={full}
        data-testid={testId}
        className={`${BUTTON} ${
          pressed
            ? "border-sky-700 bg-sky-700 text-white"
            : "border-zinc-300 bg-white text-zinc-800"
        }`}
      >
        Simular {row.name}
      </button>
    </form>
  );
}

function Gain({ row }: { row: PlanImpactRow }) {
  return <span className="font-semibold text-emerald-800">+{offers(row.delta)}</span>;
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
        <h2 id="plan-sim-titulo" className="text-sm font-semibold text-zinc-700">
          Si aprendés…
        </h2>
        <p className="text-xs text-zinc-600">
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
        <h2 id="plan-sim-titulo" className="text-sm font-semibold text-zinc-700">
          Si aprendés…
        </h2>
        <p
          data-testid="plan-sim-pocas"
          className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-600"
        >
          Con pocas ofertas todavía no podemos decirlo: cuando haya más avisos de tu carrera vas a
          ver acá cuántos se te abren con cada skill.
        </p>
      </section>
    );
  }

  const names = new Map(impact.rows.map((r) => [r.slug, r.name]));
  const sim = impact.simulation;

  return (
    <section
      data-testid="plan-sim"
      aria-labelledby="plan-sim-titulo"
      className="flex flex-col gap-3"
    >
      <h2 id="plan-sim-titulo" className="text-sm font-semibold text-zinc-700">
        Si aprendés…
      </h2>
      <p className="text-xs text-zinc-600" data-testid="plan-sim-hoy">
        Hoy te calzan {impact.passNow} de {impact.total} ofertas. Mirá cuántas más te calzarían si
        llevás una skill a nivel 2. Podés elegir hasta {MAX_SIMULAR} para ver el total junto.
      </p>

      {sim ? (
        <p
          role="status"
          data-testid="plan-sim-resultado"
          className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950"
        >
          Con {sim.slugs.map((slug) => names.get(slug) ?? slug).join(", ")} pasan{" "}
          <strong>
            {sim.passAfter} de {sim.total}
          </strong>{" "}
          ofertas (hoy pasan {sim.passNow}).{" "}
          <Link href="/plan" className="inline-flex min-h-11 items-center underline">
            Limpiar la simulación
          </Link>
        </p>
      ) : null}

      <table className="hidden w-full text-left text-sm sm:table" data-testid="plan-sim-tabla">
        <caption className="pb-2 text-left text-xs text-zinc-600">
          Ofertas que te empezarían a calzar al aprender cada skill del plan
        </caption>
        <thead>
          <tr className="border-b border-zinc-200 text-xs text-zinc-700">
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
              className="border-b border-zinc-100"
            >
              <th scope="row" className="py-2 pr-3 font-medium text-zinc-900">
                {row.name}
              </th>
              <td className="py-2 pr-3 text-zinc-700">
                {row.asks} ({row.asksMust} excluyente{row.asksMust === 1 ? "" : "s"})
              </td>
              <td className="py-2 pr-3 text-zinc-700">
                {row.passNow} → {row.passAfter}
              </td>
              <td className="py-2 pr-3">
                <Gain row={row} />
              </td>
              <td className="py-2 pr-3 text-zinc-700">
                ~{row.hours} h{row.estimated ? " (estimado)" : ""}
              </td>
              <td className="py-1">
                <PickButton row={row} selected={selected} testId={`plan-sim-pick-${row.slug}`} />
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
            className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3 text-sm"
          >
            <p className="break-words font-medium text-zinc-900">{row.name}</p>
            <p className="text-xs text-zinc-700">
              La piden {row.asks} ({row.asksMust} excluyente{row.asksMust === 1 ? "" : "s"})
            </p>
            <p className="text-xs text-zinc-700">
              Hoy te calzan {row.passNow}; con la skill, {row.passAfter}
            </p>
            <p className="text-xs">
              <Gain row={row} />
            </p>
            <p className="text-xs text-zinc-700">
              ~{row.hours} h{row.estimated ? " (estimado)" : ""}
            </p>
            <PickButton row={row} selected={selected} testId={`plan-sim-pick-m-${row.slug}`} />
          </li>
        ))}
      </ul>

      {impact.route.length ? (
        <section aria-labelledby="plan-ruta-titulo" className="flex flex-col gap-2">
          <h3 id="plan-ruta-titulo" className="text-sm font-semibold text-zinc-700">
            Ruta por semanas
          </h3>
          <ol className="flex flex-col gap-1" data-testid="plan-ruta">
            {impact.route.map((step) => (
              <li
                key={step.slug}
                className="break-words rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium">{weeks(step.weekFrom, step.weekTo)}</span> ·{" "}
                {step.name} · {step.hours} h{step.estimated ? " estimadas" : ""} · suma{" "}
                {offers(step.delta)}
              </li>
            ))}
          </ol>
          <p className="text-xs text-zinc-600">
            Con {impact.hoursPerWeek} h por semana. Ofertas de los últimos 30 días, al{" "}
            {shortDate(impact.poolDate)}.
          </p>
        </section>
      ) : null}
    </section>
  );
}
