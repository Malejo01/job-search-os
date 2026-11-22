import Link from "next/link";
import { cardClasses } from "@/components/ui";
import { loadApprovedFichas } from "@/lib/academy";

export const metadata = { title: "Academy" };
// Dentro de (app): el layout pide sesión, así que no se prerenderiza en el build
export const dynamic = "force-dynamic";

/**
 * Academy: las fichas aprobadas, en una lista. Las que siguen en borrador no se ven acá (las revisa
 * quien corresponde en `/settings/academy`). Server Component: las fichas se leen del disco.
 */
export default function AcademyPage() {
  const fichas = loadApprovedFichas();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-title font-bold">Academy</h1>
      <p className="text-fg-muted">Fichas cortas para entender mejor cada paso de tu búsqueda.</p>
      {fichas.length === 0 ? (
        <section className={cardClasses()} data-testid="academy-vacia">
          <p className="font-bold text-fg">Todavía estamos preparando las fichas</p>
          <p className="text-fg-muted">
            Las estamos revisando para que sean claras y útiles. Pronto vas a encontrarlas acá.
          </p>
        </section>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="academy-lista">
          {fichas.map((f) => (
            <li key={f.slug}>
              <Link
                href={`/academy/${f.slug}`}
                className={`${cardClasses()} flex min-h-12 items-center justify-between gap-3 font-bold text-fg hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
              >
                <span>{f.titulo}</span>
                <span aria-hidden="true" className="text-lg text-fg-subtle">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
