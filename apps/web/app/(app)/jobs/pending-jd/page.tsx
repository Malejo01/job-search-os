import Link from "next/link";
import { formatDate, SOURCE_LABELS } from "@/lib/labels";
import { CLAUDE_IN_CHROME_SNIPPET, listPendingJd, PENDING_LIMIT } from "@/lib/pending-jd";
import { requireUserId } from "@/lib/session";
import { closeJobAction, pasteJdAction } from "./actions";
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";
// La evaluación inmediata al pegar JD (JS-027) corre en `after` dentro de esta invocación
export const maxDuration = 120;

const ERRORS: Record<string, string> = {
  corta: "La descripción es muy corta (mínimo 200 caracteres): pegá el aviso completo.",
  oferta: "Oferta inexistente.",
};

/** Cola de ofertas sin JD (JS-017): ≤ 10, link al aviso, textarea para pegar la JD, botón cerrada. */
export default async function PendingJdPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const userId = await requireUserId();
  const { error, ok } = await searchParams;
  const rows = await listPendingJd(userId);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Pendientes de JD</h1>
        <p className="text-xs text-zinc-500">
          {rows.length === PENDING_LIMIT ? `primeras ${PENDING_LIMIT}` : rows.length} sin
          descripción
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {ERRORS[error] ?? "Algo falló."}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          JD guardada: evaluando ahora. En unos segundos la ves con score en{" "}
          <Link href={`/jobs/${ok}`} className="underline">
            el detalle
          </Link>{" "}
          y en{" "}
          <Link href="/jobs" className="underline">
            Ofertas
          </Link>
          , que se actualizan solas.
        </p>
      ) : null}

      <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Cómo leer la JD con Claude in Chrome
        </summary>
        <ol className="mt-2 list-decimal pl-5 text-zinc-700">
          <li>Abrí el aviso con el link de la oferta.</li>
          <li>Pegale esta instrucción a Claude in Chrome y copiá su respuesta:</li>
        </ol>
        <pre className="mt-2 whitespace-pre-wrap rounded-md bg-white p-2 text-xs text-zinc-800">
          {CLAUDE_IN_CHROME_SNIPPET}
        </pre>
        <div className="mt-2 flex items-center gap-2">
          <CopyButton text={CLAUDE_IN_CHROME_SNIPPET} />
          <span className="text-xs text-zinc-500">
            Máximo 5 avisos por día (ARCHITECTURE §5). El sistema nunca postula por vos.
          </span>
        </div>
      </details>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          No hay ofertas esperando descripción.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((job) => (
            <li key={job.id} className="rounded-lg border border-zinc-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/jobs/${job.id}`} className="text-sm font-medium hover:underline">
                    {job.title}
                  </Link>
                  <p className="text-xs text-zinc-600">
                    {job.company}
                    {job.locationRaw ? ` · ${job.locationRaw}` : ""} · {formatDate(job.firstSeenAt)}
                    {job.sourceKind ? ` · ${SOURCE_LABELS[job.sourceKind] ?? job.sourceKind}` : ""}
                  </p>
                  {job.url ? (
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs text-sky-700 underline"
                    >
                      abrir el aviso
                    </a>
                  ) : (
                    <span className="text-xs text-zinc-400">sin link al aviso</span>
                  )}
                </div>
                <form action={closeJobAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600"
                    title="La oferta ya no está disponible"
                  >
                    Cerrada
                  </button>
                </form>
              </div>
              <form action={pasteJdAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="jobId" value={job.id} />
                <textarea
                  name="jdText"
                  required
                  minLength={200}
                  rows={4}
                  placeholder="Pegá acá la descripción completa del puesto"
                  className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
                  >
                    Guardar JD y evaluar
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
