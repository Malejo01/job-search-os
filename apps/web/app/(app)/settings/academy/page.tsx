import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import { canReviewAcademy } from "@/lib/academy-access";
import { fichaWordCount, loadAcademyFichas } from "@/lib/academy";
import { reviewHistory, reviewLatestBySlug } from "@/lib/academy-revisiones";
import { renderLegalBlocks } from "@/lib/legal";
import { requireUserId } from "@/lib/session";
import { ACADEMY_REVISION, estadoDeRevision, TEXTOS_APROBACION } from "@/lib/textos-revision";
import { reviewFichaAction } from "./actions";

export const metadata = { title: "Revisar Academy" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Revisión de las fichas de Academy, con los borradores a la vista. Solo admins y testers
 * (`canReviewAcademy`, comprobado en el servidor antes de leer nada); el resto recibe el 404.
 * Cada ficha se aprueba o se le piden cambios desde acá (R26-01): la aprobación se guarda en la base con la
 * huella del contenido y vale mientras el texto no cambie. El archivo del repo (`estado: aprobada`) sigue
 * valiendo como antes.
 */
export default async function AcademyReviewPage() {
  const userId = await requireUserId();
  if (!(await canReviewAcademy(userId))) notFound();
  const fichas = loadAcademyFichas();
  // Si la lectura falla (por ejemplo, la migración todavía no está aplicada), se ve todo en borrador
  const [latest, history] = await Promise.all([
    reviewLatestBySlug(userId).catch(() => null),
    reviewHistory(userId).catch(() => null),
  ]);
  const titulos = new Map(fichas.map((f) => [f.slug, f.titulo]));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-title font-bold">{ACADEMY_REVISION.titulo}</h1>
      <p className="text-fg-muted">{ACADEMY_REVISION.intro}</p>
      <Link
        href="/settings/textos"
        className="inline-flex min-h-11 items-center self-start text-link underline underline-offset-2"
      >
        {TEXTOS_APROBACION.verTextos}
      </Link>
      {latest === null ? (
        <p role="status" className="text-sm text-danger">
          {ACADEMY_REVISION.sinLectura}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="academy-revision">
        {fichas.map((f) => {
          const ultima = latest?.get(f.slug) ?? null;
          const estado = estadoDeRevision(f, ultima);
          const revisable = latest !== null && f.estado !== "aprobada";
          return (
            <li key={f.slug} data-testid={`academy-revision-${f.slug}`}>
              <details className={cardClasses()}>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
                  <span>{f.titulo}</span>
                  <span
                    data-testid="academy-estado"
                    className="rounded-pill border border-line-strong px-2 text-xs font-bold"
                  >
                    {estado.etiqueta}
                  </span>
                  <span className="text-xs font-normal text-fg-subtle">
                    {fichaWordCount(f)} palabras
                  </span>
                </summary>
                <p className="mt-2 text-sm text-fg-muted" data-testid="academy-estado-detalle">
                  {estado.detalle}
                  {ultima?.status === "cambios" && ultima.comment ? ` «${ultima.comment}»` : ""}
                </p>
                <div className="mt-2">{renderLegalBlocks(f.blocks)}</div>
                {revisable ? (
                  <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                    <form action={reviewFichaAction}>
                      <input type="hidden" name="slug" value={f.slug} />
                      <input type="hidden" name="decision" value="aprobada" />
                      <button
                        type="submit"
                        className={buttonClasses({ variant: "primary" })}
                        data-testid="academy-aprobar"
                      >
                        {ACADEMY_REVISION.aprobar}
                      </button>
                    </form>
                    <form action={reviewFichaAction} className="flex flex-col gap-2">
                      <input type="hidden" name="slug" value={f.slug} />
                      <input type="hidden" name="decision" value="cambios" />
                      <label
                        htmlFor={`comentario-${f.slug}`}
                        className="flex flex-col gap-1 text-sm font-semibold"
                      >
                        {ACADEMY_REVISION.comentarioLabel}
                        <textarea
                          id={`comentario-${f.slug}`}
                          name="comment"
                          required
                          maxLength={500}
                          rows={3}
                          aria-describedby={`comentario-ayuda-${f.slug}`}
                          className={inputClasses({ multiline: true })}
                        />
                      </label>
                      <span id={`comentario-ayuda-${f.slug}`} className="text-xs text-fg-subtle">
                        {ACADEMY_REVISION.comentarioAyuda}
                      </span>
                      <button
                        type="submit"
                        className={buttonClasses({ variant: "secondary" })}
                        data-testid="academy-cambios"
                      >
                        {ACADEMY_REVISION.pedirCambios}
                      </button>
                    </form>
                  </div>
                ) : null}
              </details>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="academy-historial" className="flex flex-col gap-2">
        <h2 id="academy-historial" className="text-heading font-bold">
          {ACADEMY_REVISION.historialTitulo}
        </h2>
        {!history || history.length === 0 ? (
          <p className="text-sm text-fg-muted">{ACADEMY_REVISION.historialVacio}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="academy-historial">
            {history.map((h) => (
              <li
                key={`${h.slug}-${h.createdAt.getTime()}`}
                className="flex flex-col gap-0.5 rounded-card bg-surface p-3 text-sm"
              >
                <span className="font-semibold">
                  {titulos.get(h.slug) ?? h.slug} ·{" "}
                  {h.status === "aprobada" ? "Aprobada" : "Pidió cambios"}
                </span>
                {h.comment ? <span>{h.comment}</span> : null}
                <span className="text-xs text-fg-subtle">
                  {h.reviewerEmail ?? "Cuenta borrada"} · {DATE.format(h.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
