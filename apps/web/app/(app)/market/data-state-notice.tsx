import Link from "next/link";
import type { DataState } from "@/lib/market";

/** Avisos compartidos por /market y /plan: qué falta, en qué estado está y adónde ir. */

/** Sin ofertas, o con ofertas pero sin snapshot todavía; null si ya hay datos de mercado. */
export function MissingDataNotice({ state }: { state: DataState }) {
  if (state.jobsCount === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
        Todavía no llegaron ofertas. Cuando lleguen tus primeras ofertas, acá vas a ver qué piden y
        qué te falta.{" "}
        <Link href="/settings/asistente" className="text-zinc-900 underline">
          Conectar el asistente de email
        </Link>
      </p>
    );
  }
  if (state.noSkillsFound) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
        Todavía no encontramos skills en tus ofertas. Cuando lleguen ofertas con más detalle,
        aparecen acá.
      </p>
    );
  }
  if (!state.hasSnapshot) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
        Estamos armando tu mercado con las ofertas que llegaron. Se actualiza cuando guardás tus
        skills y cada lunes.
      </p>
    );
  }
  return null;
}

/** Aviso arriba de todo cuando la persona todavía no cargó niveles. */
export function NoLevelsNotice({ state }: { state: DataState }) {
  if (state.levelsKnown > 0) return null;
  return (
    <p
      data-testid="market-sin-niveles"
      className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      Todavía no cargaste tus skills: sin tus niveles, todo lo que piden las ofertas aparece como
      brecha.{" "}
      <Link href="/settings/skills" className="underline">
        Cargar mis skills
      </Link>
    </p>
  );
}
