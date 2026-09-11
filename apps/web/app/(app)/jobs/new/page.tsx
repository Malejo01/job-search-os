import Link from "next/link";
import { createManualJobAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "rounded-md border border-zinc-300 px-3 py-2 text-base";

/**
 * Ingesta manual (JS-023): una oferta vista en cualquier lado (LinkedIn, un mail, un chat) entra
 * por el mismo camino que las automáticas: dedup contra 14 días, prefiltro, estado y cola de
 * evaluación si trae JD. Sin JD queda en "Pendientes de JD". Server Component + Server Action.
 */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Nueva oferta</h1>
        <Link href="/jobs" className="text-xs text-zinc-500 hover:underline">
          ← Ofertas
        </Link>
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error === "campos" ? "Título y empresa son obligatorios." : `No se pudo: ${error}`}
        </p>
      ) : null}
      <form action={createManualJobAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Link del aviso (opcional; sirve para no cargarlo dos veces)
          <input name="url" type="url" placeholder="https://…" className={input} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Título *
            <input name="title" required className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Empresa *
            <input name="company" required className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ubicación
            <input name="location" placeholder="Remoto (Argentina), CABA…" className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Modalidad
            <select name="modality" defaultValue="desconocida" className={input}>
              <option value="remoto">Remoto</option>
              <option value="hibrido">Híbrido</option>
              <option value="presencial">Presencial</option>
              <option value="desconocida">No dice</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Salario USD mensual (mín.)
            <input name="salaryMin" type="number" min={0} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Salario USD mensual (máx.)
            <input name="salaryMax" type="number" min={0} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Candidatos (si el aviso lo dice)
            <input name="candidates" type="number" min={0} className={input} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Descripción del puesto (pegá el texto completo; si la dejás vacía queda pendiente de JD)
          <textarea name="jdText" rows={8} className={input} />
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
          >
            Cargar oferta
          </button>
        </div>
      </form>
      <p className="text-xs text-zinc-500">
        Si el link o la empresa + título ya existen en los últimos 14 días, se fusiona con la oferta
        existente en vez de duplicarla. El prefiltro determinista decide si va a evaluación.
      </p>
    </section>
  );
}
