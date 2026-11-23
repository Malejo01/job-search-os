import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { getAperturaChecklist } from "@/lib/apertura";
import { requireUserId } from "@/lib/session";

export const metadata: Metadata = { title: "Checklist de apertura", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Checklist de apertura (R22-05): lee el estado real y marca cada ítem como listo o pendiente. Solo
 * admins (404 para el resto). Muestra presencia y conteos, nunca valores de variables. Server Component,
 * sin JavaScript en el navegador.
 */
export default async function AperturaPage() {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const result = await getAperturaChecklist(userId);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Checklist de apertura</h1>
        <p className="text-sm text-fg-muted">
          El estado real de lo que tiene que estar listo antes de abrir la beta. Se calcula cada vez
          que abrís la pantalla.
        </p>
      </div>

      {!result.ok ? (
        <p role="status" className="text-sm text-fg-muted">
          No se pudo leer el estado. Probá de nuevo en un momento.
        </p>
      ) : (
        <>
          <p
            data-testid="apertura-resumen"
            role="status"
            className="rounded-card bg-surface p-4 text-sm font-semibold text-fg"
          >
            {result.checklist.pending === 0
              ? "Todo listo: no queda nada pendiente."
              : `${result.checklist.total - result.checklist.pending} de ${result.checklist.total} listos; ${
                  result.checklist.pending === 1
                    ? "queda 1 pendiente"
                    : `quedan ${result.checklist.pending} pendientes`
                }.`}
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {result.checklist.items.map((item) => (
              <li
                key={item.id}
                data-testid={`apertura-${item.id}`}
                data-estado={item.ok ? "listo" : "pendiente"}
                className="flex flex-col gap-1 rounded-card bg-surface p-4"
              >
                <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
                  <span aria-hidden="true" className={item.ok ? "text-success" : "text-warning"}>
                    {item.ok ? "✓" : "●"}
                  </span>
                  {item.label}
                  <span
                    className={`rounded-control px-2 py-0.5 text-xs font-medium ${
                      item.ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
                    }`}
                  >
                    {item.ok ? "Listo" : "Pendiente"}
                  </span>
                </h2>
                <p className="text-sm text-fg-muted">{item.detail}</p>
                {item.todo ? (
                  <p className="text-sm text-fg">
                    <span className="font-medium">Qué hacer:</span> {item.todo}{" "}
                    {item.doc?.startsWith("/") ? (
                      <Link
                        href={item.doc}
                        className="inline-flex min-h-11 items-center underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        Abrir {item.doc}
                      </Link>
                    ) : (
                      <span className="text-fg-muted">
                        Detalle en <code>{item.doc}</code>.
                      </span>
                    )}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
