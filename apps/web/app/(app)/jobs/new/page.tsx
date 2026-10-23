import Link from "next/link";
import { createManualJobAction } from "./actions";
import { JobFields } from "./job-fields";
import { PasteForm } from "./paste-form";

export const metadata = { title: "Nueva oferta" };
export const dynamic = "force-dynamic";
// Con JD completo la evaluación corre en `after` dentro de esta invocación (JS-027)
export const maxDuration = 120;

function tabClass(active: boolean): string {
  return `inline-flex min-h-11 items-center rounded-md border px-3 text-sm ${
    active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-800"
  }`;
}

/**
 * Ingesta manual (JS-023): una oferta vista en cualquier lado (LinkedIn, un mail, un chat) entra
 * por el mismo camino que las automáticas: dedup contra 14 días, prefiltro, estado y cola de
 * evaluación si trae JD. Sin JD queda en "Sin descripción". Server Component + Server Action.
 * Dos modos: completar los campos o pegar el aviso entero (`?modo=pegar`, ronda 63). Si la acción
 * redirige con `?error=`, se pierde el modo pegar: es aceptable.
 */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; modo?: string }>;
}) {
  const { error, modo } = await searchParams;
  const pegar = modo === "pegar";
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Nueva oferta</h1>
        <Link href="/jobs" className="text-xs text-zinc-600 hover:underline">
          ← Ofertas
        </Link>
      </div>
      <nav aria-label="Cómo cargar la oferta" className="flex flex-wrap gap-2">
        <Link
          href="/jobs/new"
          aria-current={pegar ? undefined : "page"}
          className={tabClass(!pegar)}
        >
          Completar campos
        </Link>
        <Link
          href="/jobs/new?modo=pegar"
          aria-current={pegar ? "page" : undefined}
          className={tabClass(pegar)}
        >
          Pegar el aviso entero
        </Link>
      </nav>
      {error ? (
        <p
          id="alta-error"
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error === "campos"
            ? "Título y empresa son obligatorios."
            : error === "url"
              ? "La URL tiene que empezar con http:// o https:// y ser una dirección pública."
              : error === "larga"
                ? "La descripción es demasiado larga: pegá solo el aviso, sin el resto de la página."
                : "No se pudo cargar la oferta. Probá de nuevo."}
        </p>
      ) : null}
      {pegar ? (
        <PasteForm error={error} />
      ) : (
        <form action={createManualJobAction} className="flex flex-col gap-3">
          <JobFields error={error} submitLabel="Cargar oferta" pendingLabel="Cargando…" />
        </form>
      )}
      <p className="text-xs text-zinc-600">
        Si el link o la descripción ya existen en los últimos 14 días, se fusiona con la oferta
        existente en vez de duplicarla. Si solo coinciden empresa y título, se guarda aparte marcada
        como posible duplicado. El prefiltro determinista decide si va a evaluación.
      </p>
    </section>
  );
}
