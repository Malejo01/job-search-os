import { betaMetricRows, betaMetricsCsv, type BetaMetricRow } from "@job-search-os/pipeline";
import { notFound } from "next/navigation";
import { getBetaMetrics } from "@/lib/beta-metrics";
import { requireUserId } from "@/lib/session";

export const metadata = { title: "Métricas de la beta" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Métricas de la beta (C-14), solo admins: agregados de los últimos 7 y 30 días para seguir el
 * piloto. Sin ningún dato individual; lo que sale de menos de k personas aparece como «<k». El CSV
 * sale de los mismos agregados, armado en el servidor. Para mostrar afuera (financiamiento), la
 * política de privacidad tiene que decirlo antes y conviene redondear.
 */
export default async function MetricasPage() {
  const userId = await requireUserId();
  const result = await getBetaMetrics(userId);
  // Para quien no es admin, la página no existe (igual que una ruta desconocida)
  if (!result.ok && result.reason === "no_admin") notFound();

  if (!result.ok) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">Métricas de la beta</h1>
        <p role="status" className="rounded-md border border-zinc-200 bg-white p-4 text-sm">
          {result.reason === "no_habilitado"
            ? "Tu cuenta es admin en la app pero todavía no está habilitada en la base (app_admins)."
            : "Todavía no hay métricas: falta aplicar la migración de la base o no se pudieron leer."}
        </p>
      </div>
    );
  }

  const { metrics } = result;
  const rows = betaMetricRows(metrics);
  const groups = [...new Set(rows.map((r) => r.group))];
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(betaMetricsCsv(metrics))}`;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Métricas de la beta</h1>
        <p className="text-sm text-zinc-600">
          Al {DATE.format(new Date(metrics.generated_at))}. Solo agregados: lo que sale de menos de{" "}
          {metrics.k} personas aparece como «&lt;{metrics.k}».
        </p>
      </div>
      {groups.map((group) => (
        <MetricTable key={group} title={group} rows={rows.filter((r) => r.group === group)} />
      ))}
      <a
        href={csvHref}
        download="metricas-beta.csv"
        className="inline-flex min-h-11 items-center self-start rounded-md border border-zinc-900 px-4 text-sm font-medium text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        Descargar CSV
      </a>
    </div>
  );
}

function MetricTable({ title, rows }: { title: string; rows: BetaMetricRow[] }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <table className="w-full text-sm">
        <caption className="mb-2 text-left font-medium">{title}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.metric} className="border-t border-zinc-100">
              <th scope="row" className="py-1 pr-3 text-left font-normal text-zinc-700">
                {r.metric}
              </th>
              <td className="py-1 text-right font-medium tabular-nums">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
