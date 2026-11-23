import {
  MARGIN_DEFAULTS,
  computeMargin,
  parseMarginParams,
  type MarginInput,
} from "@job-search-os/pipeline";
import { getUnitCosts } from "@/lib/unit-cost";

/**
 * Sección «Calculadora de margen por plan» del tablero de costos. Para montar en `/admin/costos`
 * (la página ya exige admin): `<CalculadoraMargen userId={userId} searchParams={sp} />`, con los
 * `searchParams` ya resueltos. Es un formulario GET nativo: los valores viajan en la URL, se validan y se
 * acotan en el servidor y, ante un valor inválido, ese campo vuelve a su valor por defecto. Sin JS de cliente.
 * El costo por unidad parte del medido (`getUnitCosts`) si hay datos; si no, del valor por defecto.
 */
const ARS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PCT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num = (n: number) => String(n).replace(".", ",");

type Field = { name: string; label: string; value: string; hint?: string };

function FieldInput({ f }: { f: Field }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {f.label}
      <input
        name={f.name}
        defaultValue={f.value}
        inputMode="decimal"
        autoComplete="off"
        className="min-h-11 rounded-card border border-border bg-bg px-3 text-sm text-fg"
      />
      {f.hint ? <span className="text-[11px]">{f.hint}</span> : null}
    </label>
  );
}

export async function CalculadoraMargen({
  userId,
  searchParams,
}: {
  userId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Costos por unidad de partida: los medidos si existen, si no los de referencia
  const measured = await getUnitCosts(userId);
  const base: MarginInput = {
    ...MARGIN_DEFAULTS,
    unitCostUsd: { ...MARGIN_DEFAULTS.unitCostUsd },
  };
  const origin = { offer: "por defecto", interview: "por defecto", coach: "por defecto" };
  if (measured.ok) {
    const r = measured.report;
    if (r.offer.costPerUnitUsd !== null) {
      base.unitCostUsd.offer = r.offer.costPerUnitUsd;
      origin.offer = `medido, ${measured.windowDays} días`;
    }
    if (r.interview.costPerUnitUsd !== null) {
      base.unitCostUsd.interview = r.interview.costPerUnitUsd;
      origin.interview = `medido, ${measured.windowDays} días`;
    }
    if (r.coach.costPerUnitUsd !== null) {
      base.unitCostUsd.coach = r.coach.costPerUnitUsd;
      origin.coach = `medido, ${measured.windowDays} días`;
    }
  }

  const input = parseMarginParams(searchParams, base);
  const calc = computeMargin(input);

  const fields: Field[] = [
    { name: "precio", label: "Precio del plan por mes (ARS)", value: num(input.priceArs) },
    { name: "tc", label: "Tipo de cambio (ARS por USD, manual)", value: num(input.exchangeRate) },
    { name: "comision", label: "Comisión de Mercado Pago (%)", value: num(input.mpCommissionPct) },
    {
      name: "ofertas",
      label: "Ofertas evaluadas por persona y mes",
      value: num(input.usage.offers),
    },
    {
      name: "simulaciones",
      label: "Simulaciones de Interview por persona y mes",
      value: num(input.usage.interviews),
    },
    {
      name: "charlas",
      label: "Charlas del coach por persona y mes",
      value: num(input.usage.coachChats),
    },
    {
      name: "c_oferta",
      label: "Costo por oferta (USD)",
      value: num(input.unitCostUsd.offer),
      hint: `Partida: ${origin.offer}`,
    },
    {
      name: "c_simulacion",
      label: "Costo por simulación (USD)",
      value: num(input.unitCostUsd.interview),
      hint: `Partida: ${origin.interview}`,
    },
    {
      name: "c_charla",
      label: "Costo por charla del coach (USD)",
      value: num(input.unitCostUsd.coach),
      hint: `Partida: ${origin.coach}`,
    },
    { name: "vercel", label: "Vercel por mes (USD)", value: num(input.fixedUsd.vercel) },
    { name: "neon", label: "Neon por mes (USD)", value: num(input.fixedUsd.neon) },
    { name: "otros", label: "Otros fijos por mes (USD)", value: num(input.fixedUsd.other) },
  ];

  return (
    <section
      data-testid="costos-calculadora"
      aria-labelledby="calculadora-margen"
      className="flex flex-col gap-3 rounded-card bg-surface p-4"
    >
      <h2 id="calculadora-margen" className="text-sm font-semibold text-fg">
        Calculadora de margen por plan
      </h2>
      <p className="text-xs text-fg-muted">
        Margen de contribución por persona, antes de impuestos propios. Los valores van en la URL:
        un valor inválido vuelve al de referencia.
      </p>
      <form method="get" className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <FieldInput key={f.name} f={f} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-card bg-accent px-4 text-sm font-medium text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Calcular
          </button>
          <a
            href="?"
            className="inline-flex min-h-11 items-center rounded-card px-4 text-sm text-fg-muted underline"
          >
            Volver a los valores de referencia
          </a>
        </div>
      </form>
      {!calc.ok ? (
        <p role="status" className="text-xs text-fg-muted">
          No se pudo calcular con esos valores.
        </p>
      ) : (
        <div
          role="region"
          aria-label="Resultado de la calculadora"
          tabIndex={0}
          className="overflow-x-auto"
        >
          <table
            className="w-full min-w-[22rem] text-left text-sm"
            data-testid="costos-calculadora-resultado"
          >
            <caption className="sr-only">Resultado por persona y por mes</caption>
            <thead className="text-xs text-fg-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Concepto
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 font-normal">
                  Costo de IA por persona
                </th>
                <td className="py-2 text-right tabular-nums">
                  {USD.format(calc.value.aiCostUsd)} (ARS {ARS.format(calc.value.aiCostArs)})
                </td>
              </tr>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 font-normal">
                  Comisión de Mercado Pago
                </th>
                <td className="py-2 text-right tabular-nums">
                  ARS {ARS.format(calc.value.commissionArs)}
                </td>
              </tr>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 font-normal">
                  Margen por persona
                </th>
                <td className="py-2 text-right font-medium tabular-nums text-fg">
                  ARS {ARS.format(calc.value.marginArs)}
                  {calc.value.marginPct === null ? "" : ` (${PCT.format(calc.value.marginPct)} %)`}
                </td>
              </tr>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 font-normal">
                  Costos fijos por mes
                </th>
                <td className="py-2 text-right tabular-nums">
                  {USD.format(calc.value.fixedUsd)} (ARS {ARS.format(calc.value.fixedArs)})
                </td>
              </tr>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 font-normal">
                  Punto de equilibrio
                </th>
                <td className="py-2 text-right font-medium tabular-nums text-fg">
                  {calc.value.breakEven.kind === "personas"
                    ? `${ARS.format(calc.value.breakEven.people)} personas pagas`
                    : "No alcanza: el margen por persona no es positivo"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
