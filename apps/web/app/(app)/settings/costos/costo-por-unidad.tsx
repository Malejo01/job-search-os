import { MIN_PEOPLE_FOR_PERCENTILES, type UnitCost } from "@job-search-os/pipeline";
import { getUnitCosts } from "@/lib/unit-cost";

/**
 * Sección «Costo por unidad» del tablero de costos. Para montar en `/settings/costos` (la página ya
 * exige admin): `<CostoPorUnidad userId={userId} />`. Solo agregados; «sin datos» cuando no hay unidades
 * y «menos de 3» cuando hay pocas personas para dar p50 y p90.
 */
const USD = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const INT = new Intl.NumberFormat("es-AR");

const ROWS: {
  key: "offer" | "interview" | "coach" | "cvDiagnosis";
  label: string;
  unit: string;
}[] = [
  { key: "offer", label: "Oferta evaluada", unit: "evaluaciones" },
  { key: "interview", label: "Simulación de Interview", unit: "simulaciones" },
  { key: "coach", label: "Charla del coach", unit: "charlas" },
  { key: "cvDiagnosis", label: "Diagnóstico del CV", unit: "diagnósticos" },
];

function perUnit(c: UnitCost): string {
  return c.costPerUnitUsd === null ? "Sin datos" : USD.format(c.costPerUnitUsd);
}

export async function CostoPorUnidad({ userId }: { userId: string }) {
  const result = await getUnitCosts(userId);
  return (
    <section
      data-testid="costos-por-unidad"
      aria-labelledby="costo-por-unidad"
      className="flex flex-col gap-2 rounded-card bg-surface p-4"
    >
      <h2 id="costo-por-unidad" className="text-sm font-semibold text-fg">
        Costo por unidad
      </h2>
      {!result.ok ? (
        <p role="status" className="text-xs text-fg-muted">
          No se pudieron leer los costos por unidad.
        </p>
      ) : (
        <>
          <p className="text-xs text-fg-muted">
            Últimos {result.windowDays} días, solo el costo informado por el proveedor.
          </p>
          <div role="region" aria-label="Costo por unidad" tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">Costo de IA por unidad de uso</caption>
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Unidad
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Cantidad
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Gasto
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Costo por unidad
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const c = result.report[r.key];
                  return (
                    <tr key={r.key} className="border-t border-border">
                      <th scope="row" className="py-2 pr-3 font-normal text-fg">
                        {r.label}
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {INT.format(c.units)} {r.unit}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {USD.format(c.spendUsd)}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium text-fg">
                        {perUnit(c)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-fg" data-testid="costos-persona-activa">
            <span className="font-medium">Persona activa:</span>{" "}
            {result.report.person.kind === "sin_datos" ? (
              "sin datos"
            ) : result.report.person.kind === "menos_de_3" ? (
              `menos de ${MIN_PEOPLE_FOR_PERCENTILES} personas con gasto: no se muestra p50 ni p90`
            ) : (
              <>
                p50 {USD.format(result.report.person.p50Usd)} · p90{" "}
                {USD.format(result.report.person.p90Usd)} en el período (
                {INT.format(result.report.person.people)} personas con gasto)
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
