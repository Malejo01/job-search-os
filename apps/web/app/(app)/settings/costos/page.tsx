import { formatUsd, type ProjectionLevel, type SpendBoard } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { getSpendBoard, SPEND_BOARD_DAYS } from "@/lib/llm-spend-board";
import { requireUserId } from "@/lib/session";

export const metadata: Metadata = { title: "Costos de IA", robots: { index: false } };
export const dynamic = "force-dynamic";

const LEVEL: Record<ProjectionLevel, { label: string; box: string }> = {
  verde: { label: "Dentro del tope", box: "bg-success-soft text-success" },
  amarillo: { label: "Cerca del tope", box: "bg-warning-soft text-warning" },
  rojo: { label: "Pasa el tope", box: "bg-danger-soft text-danger" },
  gris: { label: "Sin tope", box: "bg-surface-muted text-fg-muted" },
};

const TIME = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});
const INT = new Intl.NumberFormat("es-AR");
const PCT = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 1 });
const percent = (n: number) => PCT.format(n);

const SECTION = "flex flex-col gap-2 rounded-card bg-surface p-4";
const TH = "py-1 pr-2 font-medium";
// Con teclado se puede desplazar a 360 px (axe: scrollable-region-focusable)
const SCROLL =
  "overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus";

/** Barra horizontal hecha con CSS: decorativa, el número va siempre en texto al lado. */
function Bar({ ratio }: { ratio: number }) {
  const width = `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%`;
  return (
    <span aria-hidden="true" className="block h-2 w-full min-w-16 rounded-pill bg-surface-muted">
      <span className="block h-2 rounded-pill bg-fg-muted" style={{ width }} />
    </span>
  );
}

function SummarySection({ board, capDailyUsd }: { board: SpendBoard; capDailyUsd: number | null }) {
  const { projection: p, totals: t } = board;
  const level = LEVEL[p.level];
  return (
    <section data-testid="costos-resumen" aria-labelledby="costos-resumen-h" className={SECTION}>
      <h2 id="costos-resumen-h" className="text-sm font-semibold text-fg">
        Proyección del mes
      </h2>
      <p
        data-testid="costos-proyeccion"
        data-level={p.level}
        className={`rounded-card px-4 py-3 text-base font-bold ${level.box}`}
      >
        {level.label}: {formatUsd(p.projectedUsd)}
        {p.capMonthUsd === null
          ? " (sin tope diario configurado)"
          : ` de ${formatUsd(p.capMonthUsd)} (${percent(p.ratio ?? 0)})`}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-fg-muted">
        <dt>Promedio diario, últimos 7 días</dt>
        <dd className="text-fg tabular-nums">{formatUsd(p.avg7, 3)}</dd>
        <dt>Promedio diario, {SPEND_BOARD_DAYS} días</dt>
        <dd className="text-fg tabular-nums">{formatUsd(p.avg30, 3)}</dd>
        <dt>Tope diario (LLM_DAILY_CAP_USD)</dt>
        <dd className="text-fg tabular-nums">
          {capDailyUsd === null ? "sin tope" : formatUsd(capDailyUsd)}
        </dd>
        <dt>Gasto de los {SPEND_BOARD_DAYS} días</dt>
        <dd className="text-fg tabular-nums">{formatUsd(t.usd)}</dd>
        <dt>Llamadas</dt>
        <dd className="text-fg tabular-nums">{INT.format(t.calls)}</dd>
        <dt>Fallidas</dt>
        <dd data-testid="costos-fallidas" className="text-fg tabular-nums">
          {INT.format(t.failed)} ({percent(t.failureRate)})
        </dd>
        <dt>Entró el modelo de respaldo</dt>
        <dd data-testid="costos-respaldo" className="text-fg tabular-nums">
          {INT.format(t.fallbacks)} ({percent(t.fallbackRate)})
        </dd>
        <dt>Sin tarifa (no suman USD)</dt>
        <dd className="text-fg tabular-nums">{INT.format(t.unpriced)}</dd>
      </dl>
      <p className="text-xs text-fg-muted">
        Proyección = promedio de los últimos 7 días × 30, contra el tope diario × 30. Con la
        variable en 0 no hay tope y no se compara.
      </p>
    </section>
  );
}

function DailySection({ board }: { board: SpendBoard }) {
  return (
    <section data-testid="costos-por-dia" aria-labelledby="costos-dia-h" className={SECTION}>
      <h2 id="costos-dia-h" className="text-sm font-semibold text-fg">
        Gasto por día
      </h2>
      <div role="region" aria-label="Gasto por día" tabIndex={0} className={SCROLL}>
        <table className="w-full min-w-[30rem] text-left text-xs tabular-nums">
          <caption className="sr-only">
            Gasto de IA por día, últimos {SPEND_BOARD_DAYS} días
          </caption>
          <thead className="text-fg-muted">
            <tr>
              <th scope="col" className={TH}>
                Día
              </th>
              <th scope="col" className={TH}>
                Gasto
              </th>
              <th scope="col" className={`${TH} w-1/3`}>
                <span className="sr-only">Proporción del día más caro</span>
              </th>
              <th scope="col" className={TH}>
                Llamadas
              </th>
              <th scope="col" className="py-1 font-medium">
                Fallidas
              </th>
            </tr>
          </thead>
          <tbody className="text-fg">
            {[...board.daily].reverse().map((d) => (
              <tr key={d.day} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 font-medium">
                  {d.day}
                </th>
                <td className="py-1 pr-2">{formatUsd(d.usd, 3)}</td>
                <td className="py-1 pr-2">
                  <Bar ratio={board.maxDailyUsd > 0 ? d.usd / board.maxDailyUsd : 0} />
                </td>
                <td className="py-1 pr-2">{INT.format(d.calls)}</td>
                <td className="py-1">{INT.format(d.failed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">
        Días en hora de Argentina; los días sin llamadas figuran en 0.
      </p>
    </section>
  );
}

function TasksSection({ board }: { board: SpendBoard }) {
  return (
    <section data-testid="costos-por-tarea" aria-labelledby="costos-tarea-h" className={SECTION}>
      <h2 id="costos-tarea-h" className="text-sm font-semibold text-fg">
        Gasto, fallas y respaldos por tarea
      </h2>
      {board.tasks.length === 0 ? (
        <p role="status" className="text-xs text-fg-muted">
          Sin llamadas en los últimos {SPEND_BOARD_DAYS} días.
        </p>
      ) : (
        <div role="region" aria-label="Gasto por tarea" tabIndex={0} className={SCROLL}>
          <table className="w-full min-w-[36rem] text-left text-xs tabular-nums">
            <caption className="sr-only">
              Gasto de IA por tarea, últimos {SPEND_BOARD_DAYS} días
            </caption>
            <thead className="text-fg-muted">
              <tr>
                <th scope="col" className={TH}>
                  Tarea
                </th>
                <th scope="col" className={TH}>
                  Gasto
                </th>
                <th scope="col" className={TH}>
                  Parte
                </th>
                <th scope="col" className={TH}>
                  Llamadas
                </th>
                <th scope="col" className={TH}>
                  Fallidas
                </th>
                <th scope="col" className="py-1 font-medium">
                  Con respaldo
                </th>
              </tr>
            </thead>
            <tbody className="text-fg">
              {board.tasks.map((t) => (
                <tr key={t.task} className="border-t border-line">
                  <th scope="row" className="py-1 pr-2 font-medium">
                    <code>{t.task}</code>
                  </th>
                  <td className="py-1 pr-2">{formatUsd(t.usd, 3)}</td>
                  <td className="py-1 pr-2">{percent(t.share)}</td>
                  <td className="py-1 pr-2">{INT.format(t.calls)}</td>
                  <td className="py-1 pr-2">
                    {INT.format(t.failed)} ({percent(t.failureRate)})
                  </td>
                  <td className="py-1">
                    {INT.format(t.fallbacks)} ({percent(t.fallbackRate)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-fg-muted">
        «Con respaldo»: llamadas hechas con el modelo de respaldo que hoy figura en{" "}
        <code>model_routing</code> para esa tarea.
      </p>
    </section>
  );
}

function ModelsSection({ board }: { board: SpendBoard }) {
  return (
    <section data-testid="costos-por-modelo" aria-labelledby="costos-modelo-h" className={SECTION}>
      <h2 id="costos-modelo-h" className="text-sm font-semibold text-fg">
        Gasto por modelo
      </h2>
      {board.models.length === 0 ? (
        <p role="status" className="text-xs text-fg-muted">
          Sin llamadas en los últimos {SPEND_BOARD_DAYS} días.
        </p>
      ) : (
        <div role="region" aria-label="Gasto por modelo" tabIndex={0} className={SCROLL}>
          <table className="w-full min-w-[30rem] text-left text-xs tabular-nums">
            <caption className="sr-only">
              Gasto de IA por modelo, últimos {SPEND_BOARD_DAYS} días
            </caption>
            <thead className="text-fg-muted">
              <tr>
                <th scope="col" className={TH}>
                  Modelo
                </th>
                <th scope="col" className={TH}>
                  Gasto
                </th>
                <th scope="col" className={TH}>
                  Parte
                </th>
                <th scope="col" className={TH}>
                  Llamadas
                </th>
                <th scope="col" className="py-1 font-medium">
                  Fallidas
                </th>
              </tr>
            </thead>
            <tbody className="text-fg">
              {board.models.map((m) => (
                <tr key={m.model} className="border-t border-line">
                  <th scope="row" className="py-1 pr-2 font-medium">
                    <code>{m.model}</code>
                  </th>
                  <td className="py-1 pr-2">{formatUsd(m.usd, 3)}</td>
                  <td className="py-1 pr-2">{percent(m.share)}</td>
                  <td className="py-1 pr-2">{INT.format(m.calls)}</td>
                  <td className="py-1">
                    {INT.format(m.failed)} ({percent(m.failureRate)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Costos de IA (R21-01), solo admins. Agregados de `llm_calls` de los últimos 30 días, sin personas.
 * Orden de las secciones: 1) proyección y totales, 2) por día, 3) por tarea (con fallas y respaldos),
 * 4) por modelo. Las secciones de costo por unidad y de la calculadora de margen (R21-02 y R21-03)
 * se montan después del bloque por modelo, antes del pie. Sin JS de cliente.
 */
export default async function CostosPage() {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const result = await getSpendBoard(userId);
  if (!result.ok && result.reason === "no_admin") notFound();

  if (!result.ok) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-title font-bold">Costos de IA</h1>
        <p role="status" className="rounded-card bg-surface p-4 text-sm">
          {result.reason === "no_habilitado"
            ? "Tu cuenta es admin en la app pero todavía no está habilitada en la base (app_admins)."
            : "Todavía no hay datos: falta aplicar la migración de la base o no se pudieron leer."}
        </p>
      </div>
    );
  }

  const { board, capDailyUsd } = result;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Costos de IA</h1>
        <p className="text-sm text-fg-muted">
          Últimos {SPEND_BOARD_DAYS} días, al {TIME.format(new Date(board.generatedAt))}. Solo
          totales: sin datos de personas.
        </p>
      </div>
      <SummarySection board={board} capDailyUsd={capDailyUsd} />
      <DailySection board={board} />
      <TasksSection board={board} />
      <ModelsSection board={board} />
      {/* R21-02 y R21-03: acá se montan «costo por unidad» y «calculadora de margen» */}
      <p className="text-sm">
        <Link href="/settings/salud" className="font-semibold text-link underline">
          Salud de la beta
        </Link>{" "}
        (el gasto de 24 horas contra el tope y las alertas de hoy).
      </p>
    </div>
  );
}
