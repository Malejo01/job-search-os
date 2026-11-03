import Link from "next/link";
import type { DataState } from "@/lib/market";
import { Alert, textLinkClasses } from "@/components/ui";

// C9-11: vacío como el `EmptyState` (panel blanco de radio 32), con el link dentro de la frase
const EMPTY = "rounded-container bg-surface px-6 py-8 text-center text-sm text-fg-muted";
const LINK = textLinkClasses();

/** Avisos compartidos por /market y /plan: qué falta, en qué estado está y adónde ir. */

/** Sin ofertas, o con ofertas pero sin snapshot todavía; null si ya hay datos de mercado. */
export function MissingDataNotice({ state }: { state: DataState }) {
  if (state.jobsCount === 0) {
    return (
      <p className={EMPTY}>
        Todavía no llegaron ofertas. Cuando lleguen tus primeras ofertas, acá vas a ver qué piden y
        qué te falta.{" "}
        <Link href="/settings/asistente" className={LINK}>
          Conectar el asistente de email
        </Link>
      </p>
    );
  }
  if (state.noSkillsFound) {
    return (
      <p className={EMPTY}>
        Todavía no encontramos skills en tus ofertas. Cuando lleguen ofertas con más detalle,
        aparecen acá. Mientras tanto podés{" "}
        <Link href="/jobs/new" className={LINK}>
          pegar una oferta completa
        </Link>
        .
      </p>
    );
  }
  if (!state.hasSnapshot) {
    return (
      <p className={EMPTY}>
        Estamos armando tu mercado con las ofertas que llegaron. Volvé en unos minutos; también se
        actualiza cuando guardás tus skills y cada lunes.
      </p>
    );
  }
  return null;
}

/** Aviso arriba de todo cuando la persona todavía no cargó niveles. */
export function NoLevelsNotice({ state }: { state: DataState }) {
  if (state.levelsKnown > 0) return null;
  return (
    <Alert tone="warning" role={null} data-testid="market-sin-niveles">
      <p>
        Todavía no cargaste tus skills: sin tus niveles, todo lo que piden las ofertas aparece como
        brecha.{" "}
        <Link href="/settings/skills" className="font-semibold underline underline-offset-2">
          Cargar mis skills
        </Link>
      </p>
    </Alert>
  );
}
