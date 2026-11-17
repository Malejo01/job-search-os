import { betaHealth, type HealthLevel } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { getAssistantMetrics } from "@/lib/assistant-metrics";
import { getBetaHealth } from "@/lib/beta-health";
import { requireUserId } from "@/lib/session";

export const metadata: Metadata = { title: "Salud de la beta", robots: { index: false } };
export const dynamic = "force-dynamic";

const TIME = new Intl.DateTimeFormat("es-AR", {
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

const LEVEL: Record<HealthLevel, { label: string; dot: string; box: string }> = {
  verde: { label: "Bien", dot: "bg-success", box: "bg-success-soft text-success" },
  amarillo: { label: "Mirar", dot: "bg-warning", box: "bg-warning-soft text-warning" },
  rojo: { label: "Actuar", dot: "bg-danger", box: "bg-danger-soft text-danger" },
  gris: { label: "Sin dato", dot: "bg-fg-subtle", box: "bg-surface-muted text-fg-muted" },
};

const USD = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const ONE_DECIMAL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const dash = (v: number | null, f: (n: number) => string) => (v === null ? "—" : f(v));

/**
 * Asistente, últimos 7 días (R9-2): charlas, mensajes y costo por charla, y cuántas cortaron por
 * tope. Solo números agregados: sin contenido de charlas ni ids de personas. «—» = sin dato (las
 * charlas anteriores a la medición no tienen mensajes contados).
 */
async function AssistantBlock({ userId }: { userId: string }) {
  const result = await getAssistantMetrics(userId);
  return (
    <section
      data-testid="salud-asistente"
      aria-labelledby="asistente-7d"
      className="flex flex-col gap-2 rounded-card bg-surface p-4"
    >
      <h2 id="asistente-7d" className="text-sm font-semibold text-fg">
        Asistente, últimos 7 días
      </h2>
      {!result.ok ? (
        <p role="status" className="text-xs text-fg-muted">
          No se pudieron leer los datos del asistente.
        </p>
      ) : (
        // Con teclado se puede desplazar a 360 px (axe: scrollable-region-focusable)
        <div
          role="region"
          aria-label="Asistente, últimos 7 días"
          tabIndex={0}
          className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <table className="w-full min-w-[30rem] text-left text-xs tabular-nums">
            <caption className="sr-only">Charlas del asistente por día</caption>
            <thead className="text-fg-muted">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Día
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Charlas
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Mensajes (prom. / máx.)
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Costo por charla (prom. / p90)
                </th>
                <th scope="col" className="py-1 font-medium">
                  Cortaron por tope
                </th>
              </tr>
            </thead>
            <tbody className="text-fg">
              {result.days.map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <th scope="row" className="py-1 pr-2 font-medium">
                    {d.day}
                  </th>
                  <td className="py-1 pr-2">{d.conversations}</td>
                  <td className="py-1 pr-2">
                    {dash(d.messagesAvg, (n) => ONE_DECIMAL.format(n))} /{" "}
                    {dash(d.messagesMax, (n) => String(n))}
                  </td>
                  <td className="py-1 pr-2">
                    {dash(d.costAvgUsd, (n) => USD.format(n))} /{" "}
                    {dash(d.costP90Usd, (n) => USD.format(n))}
                    {d.costUnknown > 0 ? ` (${d.costUnknown} sin costo)` : ""}
                  </td>
                  <td className="py-1">{d.cappedConversations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-fg-muted">
        Por charla, no por persona. Los topes actuales están en <code>docs/OPERACION.md</code>.
      </p>
    </section>
  );
}

/**
 * Salud diaria de la beta (C8-11): la pantalla que Mauro mira cada mañana. Solo para quien administra
 * la beta (para el resto, 404). Conteos agregados, sin datos de nadie; se actualizan cada 5 minutos.
 * Los umbrales salen de docs/beta/capacidad.md.
 */
export default async function SaludPage() {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const result = await getBetaHealth(userId);
  if (!result.ok && result.reason === "no_admin") notFound();

  if (!result.ok) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-title font-bold">Salud de la beta</h1>
        <p role="status" className="rounded-card bg-surface p-4 text-sm">
          No se pudieron leer los datos. Probá de nuevo en un rato.
        </p>
      </div>
    );
  }

  const { rows, overall } = betaHealth(result.input);
  const top = LEVEL[overall];
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Salud de la beta</h1>
        <p className="text-sm text-fg-muted">
          Datos de las {TIME.format(result.at)}; se actualizan cada 5 minutos. Umbrales de{" "}
          <code>docs/beta/capacidad.md</code>.
        </p>
      </div>
      <p
        data-testid="salud-general"
        data-level={overall}
        className={`rounded-card px-4 py-3 text-base font-bold ${top.box}`}
      >
        En general: {top.label}
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((r) => {
          const l = LEVEL[r.level];
          return (
            <li
              key={r.key}
              data-testid={`salud-${r.key}`}
              data-level={r.level}
              className="flex items-start gap-3 rounded-card bg-surface p-4"
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 h-3 w-3 shrink-0 rounded-pill ${l.dot}`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-fg">{r.label}</h2>
                  <span className={`rounded-badge px-2 py-0.5 text-xs font-bold ${l.box}`}>
                    {l.label}
                  </span>
                </div>
                <p className="text-base font-bold text-fg tabular-nums">{r.value}</p>
                <p className="text-xs text-fg-muted">{r.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <section
        data-testid="salud-alertas-gasto"
        aria-labelledby="alertas-gasto"
        className="flex flex-col gap-1 rounded-card bg-surface p-4"
      >
        <h2 id="alertas-gasto" className="text-sm font-semibold text-fg">
          Alertas de gasto de hoy
        </h2>
        <p className="text-base font-bold text-fg tabular-nums">
          {result.budgetAlertsToday.length === 0
            ? "Ninguna"
            : result.budgetAlertsToday.map((t) => `${t} %`).join(", ")}
        </p>
        <p className="text-xs text-fg-muted">
          Se avisa por email a los admins al pasar el 70, el 85 y el 95 % del tope diario, una vez
          por umbral y por día (UTC). El gasto de 24 horas contra el tope está en «IA» más arriba.
        </p>
      </section>
      <AssistantBlock userId={userId} />
      <p className="text-sm">
        <Link href="/settings/metricas" className="font-semibold text-link underline">
          Métricas de la beta
        </Link>{" "}
        (embudo de /acceso, carreras y lo que nos contaron).
      </p>
    </div>
  );
}
