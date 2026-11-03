"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Option = { value: string; label: string };

const SCORE_STEPS = Array.from({ length: 10 }, (_, n) => n);

/**
 * Filtros de la lista (JS-015). Client component solo por la interactividad: cada cambio
 * reescribe la URL (search params) y el Server Component vuelve a consultar. Sin estado propio.
 */
export function JobFilters({
  value,
  sources,
  statuses,
}: {
  value: { score: string; fuente: string; estado: string; desde: string; periodo: string };
  sources: Option[];
  statuses: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, v: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set(key, v);
    else params.delete(key);
    // El atajo y la fecha manual son dos formas de lo mismo: elegir una limpia la otra, así
    // nunca hay dos límites compitiendo sin que se vea cuál gana (JS-061).
    if (key === "periodo" && v) params.delete("desde");
    if (key === "desde" && v) params.delete("periodo");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };
  const hasFilters = Boolean(
    value.score || value.fuente || value.estado || value.desde || value.periodo,
  );
  // Chips de filtro (C7-6, manual P1): píldoras con borde de 2 px; el foco, lima
  const select =
    "min-h-11 min-w-0 rounded-pill border-2 border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

  return (
    <form
      className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${pending ? "opacity-60" : ""}`}
      onSubmit={(e) => e.preventDefault()}
      aria-label="Filtros"
    >
      <label className="flex flex-col gap-1 text-xs font-semibold text-fg-subtle">
        Puntaje mín.
        <select
          className={select}
          value={value.score}
          onChange={(e) => set("score", e.target.value)}
        >
          <option value="">cualquiera</option>
          {/* JS-029: de 0 a 9, de a un punto (un select y no un slider: cada cambio reescribe la URL) */}
          {SCORE_STEPS.map((n) => (
            <option key={n} value={String(n)}>
              ≥ {n}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-fg-subtle">
        Fuente
        <select
          className={select}
          value={value.fuente}
          onChange={(e) => set("fuente", e.target.value)}
        >
          <option value="">todas</option>
          {sources.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-fg-subtle">
        Estado
        <select
          className={select}
          value={value.estado}
          onChange={(e) => set("estado", e.target.value)}
        >
          {/* JS-061: por defecto solo lo que todavía no tiene una acción tomada */}
          <option value="">sin revisar</option>
          <option value="activas">activas</option>
          <option value="todas">todas</option>
          {statuses.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-fg-subtle">
        Período
        <select
          className={select}
          value={value.periodo}
          onChange={(e) => set("periodo", e.target.value)}
        >
          <option value="">todas</option>
          <option value="hoy">hoy</option>
          <option value="semana">esta semana</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-fg-subtle">
        Desde
        <input
          type="date"
          className={select}
          value={value.desde}
          onChange={(e) => set("desde", e.target.value)}
        />
      </label>
      <div className="flex items-end">
        <button
          type="button"
          disabled={!hasFilters}
          onClick={() => startTransition(() => router.replace(pathname))}
          className="min-h-11 w-full rounded-pill px-3 py-2 text-sm font-semibold text-link underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:text-fg-subtle disabled:no-underline"
        >
          Limpiar
        </button>
      </div>
    </form>
  );
}
