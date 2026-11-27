import { buttonClasses } from "@/components/ui";
import { POSTULACION_TEXTOS as T } from "@/lib/textos-rediseno";

/**
 * Elegir la versión del CV y descargarla en PDF o DOCX (R34-02). Son enlaces comunes a la ruta de descarga con
 * sesión: no hace falta JavaScript y no hay URL pública (la ruta pide sesión y arma el archivo en el momento).
 * La versión adaptada solo se ofrece si la persona ya guardó una para esta oferta. La base va sin parámetros:
 * es la misma dirección que usaba la descarga anterior.
 */
export function DescargasVersion({
  jobId,
  hasAdapted,
}: {
  jobId: string;
  /** `null` si la adaptación no está disponible para esta persona: no se menciona. */
  hasAdapted: boolean | null;
}) {
  const base = `/jobs/${jobId}/postular/descargar`;
  const row = (testId: string, label: string, query: string) => (
    <div
      className="flex flex-col gap-2 rounded-card border border-line p-3"
      data-testid={testId}
      role="group"
      aria-label={label}
    >
      <p className="font-medium text-fg">{label}</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={`${base}${query ? `?${query}&formato=pdf` : "?formato=pdf"}`}
          data-testid={`${testId}-pdf`}
          className={`${buttonClasses({ size: "sm" })} w-fit`}
        >
          {T.descargar.pdf}
        </a>
        <a
          href={`${base}${query ? `?${query}` : ""}`}
          data-testid={testId === "descargar-base" ? "descargar-cv-oferta" : `${testId}-docx`}
          className={`${buttonClasses({ size: "sm", variant: "secondary" })} w-fit`}
        >
          {T.descargar.docx}
        </a>
      </div>
    </div>
  );
  return (
    <div className="mt-2 flex flex-col gap-3">
      {row("descargar-base", T.descargar.base, "")}
      {hasAdapted === true
        ? row("descargar-adaptada", T.descargar.adaptada, "version=adaptada")
        : null}
      {hasAdapted === false ? (
        <p className="text-fg-muted" data-testid="descargar-adaptada-vacia">
          {T.descargar.adaptadaSinGuardar}
        </p>
      ) : null}
      <p className="text-xs text-fg-subtle">{T.descargar.nota}</p>
    </div>
  );
}
