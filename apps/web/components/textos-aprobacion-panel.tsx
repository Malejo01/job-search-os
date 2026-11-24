import { estadoDeTexto } from "@job-search-os/pipeline";
import type { TextoRediseno } from "../lib/textos-aprobacion";
import {
  TEXTO_ESTADO_DETALLE,
  TEXTO_ESTADO_LABEL,
  TEXTOS_APROBACION,
} from "../lib/textos-revision";
import type { TextReview } from "../lib/textos-revisiones";
import { buttonClasses, inputClasses } from "./ui";

/**
 * Los textos del rediseño con su estado y los botones «Aprobar» y «Proponer otro» (R26-02). Server Component: lo
 * usan `/admin/textos` y `/settings/textos`. `latest` es lo último que se dijo de cada texto, o `null` si la
 * lectura falló (por ejemplo, una cuenta sin el rol de tester en la base): entonces se ven los textos pero no hay
 * botones. Nada de lo que se hace acá cambia la app.
 */
export function TextosAprobacionPanel({
  textos,
  latest,
  action,
}: {
  textos: readonly TextoRediseno[];
  latest: ReadonlyMap<string, TextReview> | null;
  action: (formData: FormData) => Promise<void>;
}) {
  const grupos = [...new Set(textos.map((t) => t.grupo))];
  return (
    <div className="flex flex-col gap-6" data-testid="textos-aprobacion">
      {latest === null ? (
        <p role="status" className="text-sm text-danger">
          {TEXTOS_APROBACION.sinLectura}
        </p>
      ) : null}
      {grupos.map((grupo) => (
        <section key={grupo} aria-labelledby={`grupo-${grupo}`} className="flex flex-col gap-2">
          <h3 id={`grupo-${grupo}`} className="text-sm font-bold text-fg-muted">
            {grupo}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {textos
              .filter((t) => t.grupo === grupo)
              .map((t) => (
                <TextoFila
                  key={t.clave}
                  texto={t}
                  review={latest?.get(t.clave) ?? null}
                  action={action}
                  puedeRevisar={latest !== null}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TextoFila({
  texto: t,
  review,
  action,
  puedeRevisar,
}: {
  texto: TextoRediseno;
  review: TextReview | null;
  action: (formData: FormData) => Promise<void>;
  puedeRevisar: boolean;
}) {
  const estado = estadoDeTexto(
    t.huella,
    review ? { estado: review.estado, huella: review.huella } : null,
  );
  const id = `texto-${t.clave.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return (
    <li
      className="flex flex-col gap-2 rounded-card bg-surface p-4 text-sm"
      data-testid={`texto-${t.clave}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <code className="text-xs text-fg-subtle">{t.clave}</code>
        <span
          data-testid="texto-estado"
          className="rounded-pill border border-line-strong px-2 text-xs font-bold"
        >
          {TEXTO_ESTADO_LABEL[estado]}
        </span>
      </div>
      <blockquote className="m-0 border-l-4 border-line-strong pl-3 text-fg">{t.valor}</blockquote>
      <p className="m-0 text-xs text-fg-muted" data-testid="texto-detalle">
        {TEXTO_ESTADO_DETALLE[estado]}
        {review?.estado === "propuesta" && review.proposal ? ` «${review.proposal}»` : ""}
      </p>
      {puedeRevisar ? (
        <div className="flex flex-col gap-3">
          {estado !== "aprobado" ? (
            <form action={action}>
              <input type="hidden" name="clave" value={t.clave} />
              <input type="hidden" name="decision" value="aprobada" />
              <button
                type="submit"
                className={buttonClasses({ variant: "primary" })}
                data-testid="texto-aprobar"
              >
                {TEXTOS_APROBACION.aprobar}
              </button>
            </form>
          ) : null}
          <details>
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
              {TEXTOS_APROBACION.proponer}
            </summary>
            <form action={action} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="clave" value={t.clave} />
              <input type="hidden" name="decision" value="propuesta" />
              <label htmlFor={`${id}-propuesta`} className="flex flex-col gap-1 font-semibold">
                {TEXTOS_APROBACION.propuestaLabel}
                <textarea
                  id={`${id}-propuesta`}
                  name="proposal"
                  required
                  maxLength={1000}
                  rows={3}
                  aria-describedby={`${id}-ayuda`}
                  className={inputClasses({ multiline: true })}
                />
              </label>
              <span id={`${id}-ayuda`} className="text-xs text-fg-subtle">
                {TEXTOS_APROBACION.propuestaAyuda}
              </span>
              <button
                type="submit"
                className={buttonClasses({ variant: "secondary" })}
                data-testid="texto-proponer"
              >
                {TEXTOS_APROBACION.enviarPropuesta}
              </button>
            </form>
          </details>
        </div>
      ) : null}
    </li>
  );
}
