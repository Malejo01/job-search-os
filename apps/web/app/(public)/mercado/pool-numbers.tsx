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

const NF_EN = new Intl.NumberFormat("en-US");

function updatedTextEn(hours: number | null): string {
  if (hours === null) return "no data";
  if (hours < 1) return "less than an hour ago";
  if (hours >= 48) return `${Math.floor(hours / 24)} days ago`;
  return `${hours} h ago`;
}

export function PoolNumbers({
  showcase,
  lang = "es",
}: {
  showcase: PoolShowcase | null;
  lang?: "es" | "en";
}) {
  const en = lang === "en";
  if (!showcase) {
    return (
      <p data-testid="pool-numbers" role="note" className="text-sm text-zinc-600">
        {en ? "Data being prepared." : "Datos en preparación."}
      </p>
    );
  }
  if (showcase.active === 0 && showcase.updatedHoursAgo === null) {
    return (
      <p data-testid="pool-numbers" className="text-sm text-zinc-600">
        {en ? "Loading the first postings." : "Estamos cargando las primeras ofertas."}
      </p>
    );
  }
  const nf = en ? NF_EN : NF;
  const items = en
    ? ([
        ["Active postings", nf.format(showcase.active)],
        ["Sources", nf.format(showcase.sources)],
        ["New in 24 h", nf.format(showcase.new24h)],
        ["Updated", updatedTextEn(showcase.updatedHoursAgo)],
      ] as const)
    : ([
        ["Ofertas activas", nf.format(showcase.active)],
        ["Fuentes", nf.format(showcase.sources)],
        ["Nuevas en 24 h", nf.format(showcase.new24h)],
        ["Actualizado", updatedText(showcase.updatedHoursAgo)],
      ] as const);
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
        {en
          ? "Counts the distinct postings we saw in the last 7 days across the sources we read."
          : "Cuenta los avisos distintos que vimos en los últimos 7 días en las fuentes que leemos."}
      </p>
    </div>
  );
}
