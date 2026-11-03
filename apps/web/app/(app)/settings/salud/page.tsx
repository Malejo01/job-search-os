import { betaHealth, type HealthLevel } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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

/**
 * Salud diaria de la beta (C8-11): la pantalla que Mauro mira cada mañana. Solo para quien administra
 * la beta (para el resto, 404). Conteos agregados, sin datos de nadie; se actualizan cada 5 minutos.
 * Los umbrales salen de docs/beta/capacidad.md.
 */
export default async function SaludPage() {
  const userId = await requireUserId();
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
      <p className="text-sm">
        <Link href="/settings/metricas" className="font-semibold text-link underline">
          Métricas de la beta
        </Link>{" "}
        (embudo de /acceso, carreras y lo que nos contaron).
      </p>
    </div>
  );
}
