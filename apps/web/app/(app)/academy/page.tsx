import Link from "next/link";
import { AfiDice } from "@/components/afi-dice";
import { EstadoMarca } from "@/components/estado-marca";
import { buttonClasses } from "@/components/ui";
import { AFI_DICE, ESTADOS_TEXTOS } from "@/lib/textos-rediseno";
import { fichaBajada, fichaWordCount } from "@/lib/academy";
import { readingMinutes } from "@/lib/academy-lectura";
import { loadApprovedFichasFor } from "@/lib/academy-revisiones";
import { requireUserId } from "@/lib/session";
import { AcademyBuscador } from "./academy-buscador";

export const metadata = { title: "Academy" };
// Dentro de (app): el layout pide sesión, así que no se prerenderiza en el build
export const dynamic = "force-dynamic";

/**
 * Academy: las fichas aprobadas, en una lista con buscador. Las que siguen en borrador no se ven acá
 * (las revisa quien corresponde en `/settings/academy`, donde también se aprueban: R26-01). Las fichas se
 * leen del disco en el servidor; solo el buscador es un client component.
 */
export default async function AcademyPage() {
  const fichas = await loadApprovedFichasFor(await requireUserId());
  const items = fichas.map((f) => ({
    slug: f.slug,
    titulo: f.titulo,
    bajada: fichaBajada(f),
    minutos: readingMinutes(fichaWordCount(f)),
  }));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-bold">Academy</h1>
          <p className="text-fg-muted">
            Fichas cortas para entender mejor cada paso de tu búsqueda.
          </p>
        </div>
        {/* R28-15: quien explica, ahora con su burbuja */}
        {items.length > 0 ? (
          <AfiDice pose="explicando" priority texto={AFI_DICE.academy} testId="afi-dice-academy" />
        ) : null}
      </div>
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
