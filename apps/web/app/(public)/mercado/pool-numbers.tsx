import type { PoolShowcase } from "@job-search-os/pipeline";

/**
 * Números del pool público (ronda 63): ofertas activas, fuentes, nuevas en 24 h y cuánto hace que
 * se actualizó. Sin datos (build sin base) muestra "Datos en preparación". Server Component.
 */
const NF = new Intl.NumberFormat("es-AR");

export function updatedText(hours: number | null): string {
  if (hours === null) return "sin dato";
  if (hours < 1) return "hace menos de una hora";
  if (hours >= 48) return `hace ${Math.floor(hours / 24)} días`;
  return `hace ${hours} h`;
}

export function PoolNumbers({ showcase }: { showcase: PoolShowcase | null }) {
  if (!showcase) {
    return (
      <p data-testid="pool-numbers" role="note" className="text-sm text-zinc-600">
        Datos en preparación.
      </p>
    );
  }
  if (showcase.active === 0 && showcase.updatedHoursAgo === null) {
    return (
      <p data-testid="pool-numbers" className="text-sm text-zinc-600">
        Estamos cargando las primeras ofertas.
      </p>
    );
  }
  const items = [
    ["Ofertas activas", NF.format(showcase.active)],
    ["Fuentes", NF.format(showcase.sources)],
    ["Nuevas en 24 h", NF.format(showcase.new24h)],
    ["Actualizado", updatedText(showcase.updatedHoursAgo)],
  ] as const;
  return (
    <div data-testid="pool-numbers" className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-md border border-zinc-200 bg-white p-3">
            <dt className="text-xs text-zinc-600">{label}</dt>
            <dd className="break-words text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-zinc-600">
        Cuenta los avisos distintos que vimos en los últimos 7 días en las fuentes que leemos.
      </p>
    </div>
  );
}
