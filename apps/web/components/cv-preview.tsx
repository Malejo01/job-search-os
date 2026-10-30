import type { CvDocument } from "@job-search-os/pipeline";

/**
 * Vista previa del CV (C-25, CVC-2): HTML semántico (h1, h2, h3, ul) de una columna, que es lo que
 * lee un ATS al imprimir a PDF. Todo el texto sale de `CvDocument` y React lo escapa; nada se inyecta
 * como HTML. Server Component.
 *
 * La hoja (`.cv-sheet`) emula una hoja de papel físico tanto en pantalla como al imprimir
 * (@media print): mantiene fondo blanco y texto oscuro fijos en tema claro y oscuro para evitar
 * que al exportar o imprimir en modo oscuro el texto salga blanco sobre papel blanco.
 */
export function CvPreview({ doc }: { doc: CvDocument }) {
  return (
    <article
      data-testid="cv-preview"
      lang={doc.lang}
      className="cv-sheet rounded-card border border-zinc-200 bg-white p-4 text-zinc-900 shadow-sm sm:p-6 [color-scheme:light]"
    >
      <h1 className="text-2xl font-bold text-zinc-900">{doc.name}</h1>
      {doc.headline ? <p className="text-base text-zinc-900">{doc.headline}</p> : null}
      {doc.contact.length > 0 ? (
        <p className="mt-1 break-words text-sm text-zinc-800">{doc.contact.join(" | ")}</p>
      ) : null}
      {doc.sections.map((section) => (
        <section key={section.id} aria-labelledby={`cv-${section.id}`} className="mt-4">
          <h2
            id={`cv-${section.id}`}
            className="border-b border-zinc-300 pb-0.5 text-lg font-semibold text-zinc-900"
          >
            {section.title}
          </h2>
          {section.blocks.map((block, i) => (
            <div key={i} className="mt-2">
              {block.heading ? (
                <h3 className="text-base font-semibold text-zinc-900">{block.heading}</h3>
              ) : null}
              {block.detail ? <p className="text-sm text-zinc-800">{block.detail}</p> : null}
              {block.bullets.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-sm text-zinc-900">
                  {block.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
