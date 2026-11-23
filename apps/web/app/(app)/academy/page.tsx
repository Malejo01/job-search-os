import Link from "next/link";
import { EstadoMarca } from "@/components/estado-marca";
import { buttonClasses } from "@/components/ui";
import { ESTADOS_TEXTOS } from "@/lib/textos-rediseno";
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
        <EstadoMarca
          tipo="lista-vacia"
          data-testid="academy-vacia"
          title={ESTADOS_TEXTOS.academyVacia.title}
          action={
            <Link href="/hoy" className={buttonClasses({ variant: "secondary" })}>
              {ESTADOS_TEXTOS.academyVacia.action}
            </Link>
          }
        >
          Las estamos revisando para que sean claras y útiles. Pronto vas a encontrarlas acá.
        </EstadoMarca>
      ) : (
        <AcademyBuscador
          items={items}
          accionLimpiar={ESTADOS_TEXTOS.academySinResultados.action}
          sinResultados={
            <EstadoMarca
              tipo="sin-resultados"
              title={ESTADOS_TEXTOS.academySinResultados.title}
              action={null}
              className="w-full"
            >
              {ESTADOS_TEXTOS.academySinResultados.text}
            </EstadoMarca>
          }
        />
      )}
    </div>
  );
}
