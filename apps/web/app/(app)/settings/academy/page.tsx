import { notFound } from "next/navigation";
import { cardClasses } from "@/components/ui";
import { canReviewAcademy } from "@/lib/academy-access";
import { fichaWordCount, loadAcademyFichas } from "@/lib/academy";
import { renderLegalBlocks } from "@/lib/legal";
import { requireUserId } from "@/lib/session";

export const metadata = { title: "Revisar Academy" };
export const dynamic = "force-dynamic";

/**
 * Revisión de las fichas de Academy, con los borradores a la vista. Solo admins y testers
 * (`canReviewAcademy`, comprobado en el servidor antes de leer nada); el resto recibe el 404.
 * Las fichas son archivos del repo: aprobar una es cambiar `estado: borrador` por
 * `estado: aprobada` en su archivo y publicar el cambio.
 */
export default async function AcademyReviewPage() {
  const userId = await requireUserId();
  if (!(await canReviewAcademy(userId))) notFound();
  const fichas = loadAcademyFichas();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-title font-bold">Revisar Academy</h1>
      <p className="text-fg-muted">
        Acá se ven todas las fichas, también las que siguen en borrador. Para aprobar una, el equipo
        cambia <code>estado: borrador</code> por <code>estado: aprobada</code> en su archivo (
        <code>apps/web/content/academy</code>) y lo publica. Hasta entonces, no se ve en Academy.
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="academy-revision">
        {fichas.map((f) => (
          <li key={f.slug}>
            <details className={cardClasses()}>
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
                <span>{f.titulo}</span>
                <span
                  data-testid="academy-estado"
                  className="rounded-pill border border-line-strong px-2 text-xs font-bold"
                >
                  {f.estado === "aprobada" ? "Aprobada" : "Borrador"}
                </span>
                <span className="text-xs font-normal text-fg-subtle">
                  {fichaWordCount(f)} palabras
                </span>
              </summary>
              <div className="mt-2">{renderLegalBlocks(f.blocks)}</div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
