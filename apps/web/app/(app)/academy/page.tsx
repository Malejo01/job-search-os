import { cardClasses } from "@/components/ui";
import { fichaBajada, fichaWordCount, loadApprovedFichas } from "@/lib/academy";
import { readingMinutes } from "@/lib/academy-lectura";
import { AcademyBuscador } from "./academy-buscador";

export const metadata = { title: "Academy" };
// Dentro de (app): el layout pide sesión, así que no se prerenderiza en el build
export const dynamic = "force-dynamic";

/**
 * Academy: las fichas aprobadas, en una lista con buscador. Las que siguen en borrador no se ven acá
 * (las revisa quien corresponde en `/settings/academy`). Las fichas se leen del disco en el servidor;
 * solo el buscador es un client component.
 */
export default function AcademyPage() {
  const fichas = loadApprovedFichas();
  const items = fichas.map((f) => ({
    slug: f.slug,
    titulo: f.titulo,
    bajada: fichaBajada(f),
    minutos: readingMinutes(fichaWordCount(f)),
  }));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-title font-bold">Academy</h1>
      <p className="text-fg-muted">Fichas cortas para entender mejor cada paso de tu búsqueda.</p>
      {items.length === 0 ? (
        <section className={cardClasses()} data-testid="academy-vacia">
          <p className="font-bold text-fg">Todavía estamos preparando las fichas</p>
          <p className="text-fg-muted">
            Las estamos revisando para que sean claras y útiles. Pronto vas a encontrarlas acá.
          </p>
        </section>
      ) : (
        <AcademyBuscador items={items} />
      )}
    </div>
  );
}
