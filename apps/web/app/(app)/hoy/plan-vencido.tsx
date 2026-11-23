import { expiredPlanSummary } from "@job-search-os/pipeline";
import Link from "next/link";
import { cardClasses } from "@/components/ui";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Bloque de «Hoy» cuando el plan pago venció (R22-03): explica con calma qué se mantiene y qué se pausa.
 * Lo que se pausa sale de los topes reales (`expiredPlanSummary`). Server Component, sin JavaScript en el
 * navegador. No muestra precios: el pago está en «Tu plan».
 */
export function PlanVencido({
  until,
  enabled,
}: {
  until: Date | null;
  enabled: { cv: boolean; assistant: boolean };
}) {
  const summary = expiredPlanSummary(enabled);
  return (
    <section
      data-testid="hoy-plan-vencido"
      aria-labelledby="hoy-plan-vencido-titulo"
      className={cardClasses({ padding: "md", className: "flex flex-col gap-3 lg:col-span-2" })}
    >
      <h2 id="hoy-plan-vencido-titulo" className="text-lg font-extrabold text-fg">
        {summary.title}
      </h2>
      <p className="text-sm text-fg-muted">
        {until ? `Venció el ${DATE.format(until)}. ` : ""}
        {summary.intro}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-fg">Lo que sigue igual</h3>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-fg-muted">
            {summary.keeps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        {summary.pauses.length > 0 ? (
          <div>
            <h3 className="text-sm font-bold text-fg">Lo que el plan gratis no incluye</h3>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-fg-muted">
              {summary.pauses.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <Link
        href="/settings#tu-plan"
        className="inline-flex min-h-11 items-center self-start text-sm font-bold text-brand-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Ver cómo volver al plan completo
      </Link>
    </section>
  );
}
