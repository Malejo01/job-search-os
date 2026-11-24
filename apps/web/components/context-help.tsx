import Link from "next/link";
import type { AcademyFicha } from "../lib/academy";
import type { AcademyOrigen } from "../lib/academy-lectura";
import { loadApprovedFichaFor } from "../lib/academy-revisiones";
import { renderLegalBlocks } from "../lib/legal";
import { requireUserId } from "../lib/session";

/**
 * Panel del «?» (R17-11): el ícono y la ficha de Academy que abre. `<details>` nativo: se abre con
 * Enter o espacio, lo anuncia el lector de pantalla y no necesita JS. Si la ficha no está aprobada, no
 * se dibuja nada (defensa extra: `ContextHelp` ya solo trae aprobadas). Server Component.
 */
export function ContextHelpPanel({
  ficha,
  term,
  desde,
}: {
  ficha: Pick<AcademyFicha, "slug" | "titulo" | "estado" | "blocks">;
  /** Lo que se explica, para el nombre accesible: «Qué es: palabras clave». */
  term: string;
  /** Pantalla de origen (R23-03): sale en el enlace como `?desde=`. */
  desde?: AcademyOrigen;
}) {
  if (ficha.estado !== "aprobada") return null;
  return (
    <details className="relative inline-block text-sm" data-testid={`ayuda-ficha-${ficha.slug}`}>
      <summary className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-pill text-link hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-pill border-2 border-current text-xs leading-none font-bold"
        >
          ?
        </span>
        <span className="sr-only">Qué es: {term}</span>
      </summary>
      <div
        role="region"
        aria-label={ficha.titulo}
        className="absolute top-full left-0 z-20 mt-1 max-h-80 w-72 max-w-[85vw] overflow-y-auto rounded-card border-2 border-line-strong bg-surface p-3 text-fg shadow-lg"
      >
        <p className="font-bold">{ficha.titulo}</p>
        {renderLegalBlocks(ficha.blocks)}
        <Link
          href={desde ? `/academy/${ficha.slug}?desde=${desde}` : `/academy/${ficha.slug}`}
          className="mt-3 inline-flex min-h-11 items-center text-link underline underline-offset-2"
        >
          Ver en Academy
        </Link>
      </div>
    </details>
  );
}

/**
 * «?» junto a un término: abre la ficha de Academy `slug`. Sin ficha aprobada, no aparece. «Aprobada» es lo que
 * dice el archivo o una aprobación hecha desde la app con la misma huella (R26-01). Server Component asíncrono.
 */
export async function ContextHelp({
  slug,
  term,
  desde,
}: {
  slug: string;
  term: string;
  desde?: AcademyOrigen;
}) {
  const ficha = await loadApprovedFichaFor(await requireUserId(), slug);
  if (!ficha) return null;
  return <ContextHelpPanel ficha={ficha} term={term} desde={desde} />;
}
