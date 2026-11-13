import type { BetaPoolCounts } from "@job-search-os/adapters";

const NF = new Intl.NumberFormat("es-AR");

/**
 * Los números de la portada (R11-10): solo las ofertas de las 8 carreras de la beta, y cuántas de
 * esas están en español. No es el total del pool: ese incluye tecnología en inglés y le prometía a
 * una contadora lo que el pool no tiene. Sin datos o sin ofertas, lo dice sin números. Server
 * Component.
 */
export function BetaPoolNumbers({ counts }: { counts: BetaPoolCounts | null }) {
  if (!counts) {
    return (
      <p data-testid="pool-numbers" role="note" className="text-sm text-fg-muted">
        Datos en preparación.
      </p>
    );
  }
  if (counts.total === 0) {
    return (
      <p data-testid="pool-numbers" className="text-sm text-fg-muted">
        Estamos cargando las primeras ofertas de las carreras de la beta.
      </p>
    );
  }
  const items = [
    ["Ofertas de las 8 carreras", NF.format(counts.total)],
    ["De esas, en español", NF.format(counts.spanish)],
  ] as const;
  return (
    <div data-testid="pool-numbers" className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-card bg-surface p-3">
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="break-words text-lg font-semibold text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-fg-muted">
        Cuenta los avisos distintos que vimos en los últimos 7 días en las fuentes que leemos, solo
        de las carreras de la beta. Los que no sabemos en qué idioma están no entran en «en
        español».
      </p>
    </div>
  );
}
