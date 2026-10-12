import Link from "next/link";
import type { RoleMarketView } from "@/lib/market";

/**
 * "El mercado de <rol>": las skills que más piden las ofertas públicas del rol que la persona eligió,
 * sin importar cuántas ofertas propias tenga. Server Component. La etiqueta del rol es la del seed
 * de roles, nunca la clave interna.
 */
export function RoleMarket({ view }: { view: RoleMarketView }) {
  if (view.kind === "sin_rol") {
    return (
      <section
        aria-label="Mercado del rol"
        data-testid="role-market"
        className="rounded-md border border-zinc-200 p-3 text-sm"
      >
        <p className="text-zinc-700">
          Elegí tu rol en{" "}
          <Link href="/settings/skills" className="underline">
            Mis skills
          </Link>{" "}
          y acá vas a ver qué piden las ofertas públicas para ese puesto.
        </p>
      </section>
    );
  }
  if (view.kind === "sin_datos") {
    return (
      <section
        aria-label="Mercado del rol"
        data-testid="role-market"
        className="rounded-md border border-zinc-200 p-3 text-sm"
      >
        <h2 className="font-semibold">El mercado de {view.label}</h2>
        <p className="mt-1 text-xs text-zinc-600">Todavía no hay datos para este rol.</p>
      </section>
    );
  }
  return (
    <section
      aria-label="Mercado del rol"
      data-testid="role-market"
      className="rounded-md border border-sky-200 p-3 text-sm"
    >
      <h2 className="font-semibold">El mercado de {view.label}</h2>
      <p className="text-xs text-zinc-600">
        {view.jobs} {view.jobs === 1 ? "oferta" : "ofertas"} de fuentes públicas en los últimos 30
        días · datos de la semana del {view.weekStart}
      </p>
      <ol className="mt-2 flex flex-col gap-1">
        {view.skills.map((skill) => (
          <li key={skill.slug} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-medium text-zinc-900">{skill.name}</span>
            <span className="text-zinc-600">
              {skill.mentions} {skill.mentions === 1 ? "oferta" : "ofertas"}
              {skill.mustMentions > 0 ? ` · ${skill.mustMentions} la piden como requisito` : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
