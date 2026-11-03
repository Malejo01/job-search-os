import Link from "next/link";
import type { RoleMarketView } from "@/lib/market";
import { cardClasses } from "@/components/ui";

// C9-11: tarjeta blanca sin borde lateral
const PANEL = cardClasses({ padding: "md", className: "text-sm" });

/**
 * "El mercado de <rol>": las skills que más piden las ofertas públicas del rol que la persona eligió,
 * sin importar cuántas ofertas propias tenga. Server Component. La etiqueta del rol es la del seed
 * de roles, nunca la clave interna.
 */
export function RoleMarket({ view }: { view: RoleMarketView }) {
  if (view.kind === "sin_rol") {
    return (
      <section aria-label="Mercado del rol" data-testid="role-market" className={PANEL}>
        <p className="text-fg-muted">
          Elegí tus puestos en{" "}
          <Link
            href="/settings#puesto"
            className="font-semibold text-link underline underline-offset-2"
          >
            Ajustes
          </Link>{" "}
          y acá vas a ver qué piden las ofertas públicas para cada uno.
        </p>
      </section>
    );
  }
  if (view.kind === "sin_datos") {
    return (
      <section aria-label="Mercado del rol" data-testid="role-market" className={PANEL}>
        <h2 className="text-base font-bold">El mercado de {view.label}</h2>
        <p className="mt-1 text-xs text-fg-subtle">
          Todavía no hay ofertas públicas de {view.label} para mostrar. Probá con otra carrera en
          «Explorar otra carrera».
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Mercado del rol" data-testid="role-market" className={PANEL}>
      <h2 className="text-base font-bold">El mercado de {view.label}</h2>
      <p className="text-xs text-fg-subtle">
        {view.jobs} {view.jobs === 1 ? "oferta" : "ofertas"} de fuentes públicas en los últimos 30
        días · datos de la semana del {view.weekStart}
      </p>
      <ol className="mt-2 flex flex-col gap-1">
        {view.skills.map((skill) => (
          <li key={skill.slug} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-medium text-fg">{skill.name}</span>
            <span className="text-fg-subtle">
              {skill.mentions} {skill.mentions === 1 ? "oferta" : "ofertas"}
              {skill.mustMentions > 0 ? ` · ${skill.mustMentions} la piden como requisito` : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
