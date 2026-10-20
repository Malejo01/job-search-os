import type { ShowcaseCard } from "@job-search-os/pipeline";
import Link from "next/link";
import { JobCard } from "./job-card";
import { ModalityFilter } from "./modality-filter";

/**
 * Lista de ofertas de muestra (ronda 63), común a /ofertas y /ofertas/[carrera]. El mensaje de
 * acceso va una vez arriba; cada tarjeta lleva solo un link corto. `cards === null` = sin base
 * (build del CI). Server Component.
 */
const LIST_ID = "ofertas-lista";

export function OffersList({ cards }: { cards: ShowcaseCard[] | null }) {
  if (cards === null) {
    return (
      <p role="note" className="text-sm text-zinc-600">
        Datos en preparación.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-800">
        Para ver qué tan bien te calza cada una,{" "}
        <Link href="/acceso" className="inline-flex min-h-11 items-center underline">
          pedí acceso
        </Link>
        .
      </p>
      {cards.length === 0 ? (
        <p className="text-sm text-zinc-600">
          Todavía no hay ofertas recientes acá. Probá con otra carrera o volvé en unas horas.
        </p>
      ) : (
        <>
          <ModalityFilter listId={LIST_ID} />
          <ul id={LIST_ID} className="grid gap-3 md:grid-cols-2">
            {cards.map((card) => (
              <JobCard key={card.id} card={card} />
            ))}
          </ul>
        </>
      )}
      {/* TODO(63): el email de contacto lo resuelve Mauro (igual que en /acceso) */}
      <p className="text-xs text-zinc-600">
        ¿Publicaste uno de estos avisos y querés que lo saquemos? Escribinos.
      </p>
    </div>
  );
}
