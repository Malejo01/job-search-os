import { MAX_JD_INPUT_CHARS } from "@job-search-os/pipeline";
import { HelpTip } from "@/components/help-tip";
import Link from "next/link";
import { TextareaWithCounter } from "@/components/char-counter";
import {
  Badge,
  buttonClasses,
  EmptyState,
  Icon,
  Illustration,
  inputClasses,
  textLinkClasses,
} from "@/components/ui";
import { CAP_MESSAGES } from "@/lib/evaluate-now";
import { formatDate, safeHttpUrl, SOURCE_LABELS } from "@/lib/labels";
import { listPendingJd, PENDING_LIMIT } from "@/lib/pending-jd";
import { requireUserId } from "@/lib/session";
import { closeJobAction, pasteJdAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sin descripción" };
// La evaluación inmediata al pegar JD (JS-027) corre en `after` dentro de esta invocación
export const maxDuration = 120;

// Pasos de P3: lo que se resalta y el resto de la frase
const STEPS: Array<[string, string]> = [
  ["Abrí el aviso", "con el enlace «abrir el aviso» de cada oferta."],
  ["Copiá el texto", "completo del puesto: tareas, requisitos y beneficios."],
  ["Pegalo acá", "y tocá «Guardar descripción y evaluar»: la oferta pasa a la cola para evaluar."],
];

const ERRORS: Record<string, string> = {
  corta: "La descripción es muy corta (mínimo 200 caracteres): pegá el aviso completo.",
  larga: "La descripción es demasiado larga: pegá solo el aviso, sin el resto de la página.",
  oferta: "Oferta inexistente.",
};

/** Cola de ofertas sin JD (JS-017): ≤ 10, link al aviso, textarea para pegar la JD, botón cerrada. */
export default async function PendingJdPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; cap?: string }>;
}) {
  const userId = await requireUserId();
  const { error, ok, cap } = await searchParams;
  const capMessage = cap === "user" || cap === "global" ? CAP_MESSAGES[cap] : null;
  const rows = await listPendingJd(userId);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Columna de la izquierda (P3): qué es, cómo se completa y cargar una a mano */}
      <section
        aria-labelledby="sin-descripcion-titulo"
        className="flex flex-col gap-4 lg:w-96 lg:shrink-0"
      >
        <div className="flex flex-col gap-1">
          <h1 id="sin-descripcion-titulo" className="text-title font-bold">
            Sin descripción
          </h1>
          <p className="text-sm text-fg-muted">
            Ofertas que llegaron por email sin el texto del aviso. Con la descripción completa las
            evaluamos contra tu perfil.
          </p>
          <HelpTip topic="sinDescripcion" />
        </div>
        <Illustration scene="sin-descripcion" size="lg" className="self-center" />
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <h2 className="text-base font-bold">Cómo completar una oferta</h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-fg-muted">
            {STEPS.map(([strong, rest], i) => (
              <li key={strong} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-brand text-sm font-bold text-brand-contrast"
                >
                  {i + 1}
                </span>
                <span className="pt-0.5">
                  <span className="font-bold text-fg">{strong}</span> {rest}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-fg-subtle">
            El sistema nunca postula por vos: la postulación la hacés vos en el sitio del aviso.
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-card border border-ink-line bg-ink p-4 text-on-ink">
          <p className="text-sm font-bold">¿La oferta no está en la lista?</p>
          <Link
            href="/jobs/new?modo=pegar"
            className="inline-flex min-h-11 items-center justify-center self-start rounded-control bg-brand px-4 text-sm font-bold text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Cargala a mano
          </Link>
        </div>
      </section>

      {/* Columna de la derecha: las ofertas, cada una con su cuadro para pegar */}
      <section
        aria-labelledby="sin-descripcion-lista"
        className="flex min-w-0 flex-1 flex-col gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sin-descripcion-lista" className="text-heading font-bold">
            {rows.length === 0
              ? "Nada para completar"
              : rows.length === PENDING_LIMIT
                ? `Las primeras ${PENDING_LIMIT} ofertas esperan descripción`
                : rows.length === 1
                  ? "1 oferta espera descripción"
                  : `${rows.length} ofertas esperan descripción`}
          </h2>
          <Badge shape="square" tone="info">
            Mínimo 200 caracteres
          </Badge>
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-control bg-danger-soft px-3 py-2 text-sm font-semibold text-danger"
          >
            {ERRORS[error] ?? "Algo falló."}
          </p>
        ) : null}
        {capMessage ? (
          <p
            role="status"
            className="rounded-control bg-warning-soft px-3 py-2 text-sm font-semibold text-warning"
          >
            Descripción guardada. {capMessage}
          </p>
        ) : null}
        {ok ? (
          <p
            role="status"
            className="rounded-control bg-success-soft px-3 py-2 text-sm font-semibold text-success"
          >
            Descripción guardada: la oferta queda en cola para evaluar. Cuando termine la ves con
            puntaje en{" "}
            <Link href={`/jobs/${ok}`} className="underline">
              el detalle
            </Link>{" "}
            y en{" "}
            <Link href="/jobs" className="underline">
              Ofertas
            </Link>
            .
          </p>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            action={
              <Link href="/jobs" className={textLinkClasses({ block: true })}>
                Ver mis ofertas
              </Link>
            }
          >
            No hay ofertas esperando descripción. Cuando llegue una por email sin el texto del
            aviso, aparece acá.
          </EmptyState>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {rows.map((job) => {
              const url = safeHttpUrl(job.url);
              return (
                <li key={job.id} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="text-[15px] font-bold text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        {job.title}
                      </Link>
                      <p className="text-xs text-fg-subtle">
                        {[job.company, job.locationRaw, formatDate(job.firstSeenAt)]
                          .filter(Boolean)
                          .join(" · ")}
                        {job.sourceKind ? (
                          <>
                            {" · "}
                            <Badge shape="square" tone="info">
                              {SOURCE_LABELS[job.sourceKind] ?? job.sourceKind}
                            </Badge>
                          </>
                        ) : null}
                      </p>
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        abrir el aviso
                        <Icon name="abrirAviso" size={14} />
                        <span className="sr-only"> (se abre en otra pestaña)</span>
                      </a>
                    ) : (
                      <span className="shrink-0 text-xs text-fg-subtle">sin link al aviso</span>
                    )}
                  </div>
                  <form action={pasteJdAction} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="jobId" value={job.id} />
                    <label htmlFor={`jd-${job.id}`} className="sr-only">
                      {`Descripción de ${job.title}`}
                    </label>
                    <TextareaWithCounter
                      id={`jd-${job.id}`}
                      name="jdText"
                      required
                      min={200}
                      softMin={200}
                      max={MAX_JD_INPUT_CHARS}
                      rows={5}
                      placeholder="Pegá acá la descripción completa del puesto"
                      className={inputClasses({ multiline: true, className: "text-sm" })}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        className={buttonClasses({ variant: "dark", size: "sm" })}
                      >
                        Guardar descripción y evaluar
                      </button>
                    </div>
                  </form>
                  {/* «Cerrada» va en su propio form: no puede ir dentro del de pegar */}
                  <form action={closeJobAction} className="mt-2">
                    <input type="hidden" name="jobId" value={job.id} />
                    <button
                      type="submit"
                      className={buttonClasses({ variant: "ghost", size: "sm" })}
                      title="La oferta ya no está disponible"
                    >
                      Cerrada
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
