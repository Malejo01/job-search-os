import type { SkillCandidate } from "@/lib/market";

/** Términos frecuentes fuera de la taxonomía: propuesta, no entra a la demanda. */
export function SkillCandidates({ candidates }: { candidates: SkillCandidate[] }) {
  return (
    <details className="rounded-card border border-line p-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
        Términos que podrían ser skills nuevas ({candidates.length})
      </summary>
      <p className="mt-2 text-xs text-fg-subtle">
        Términos frecuentes en los avisos que todavía no están en nuestra lista de skills. Salen de
        las últimas 300 ofertas con texto, no del rango de semanas elegido, y se actualizan cada
        hora. No cuentan en la demanda hasta que los sumemos a la lista.
      </p>
      {candidates.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {candidates.map((c) => (
            <li
              key={c.term}
              className="rounded-control border border-line bg-surface px-2 py-1 text-xs text-fg"
            >
              {c.term}{" "}
              <span className="tabular-nums text-fg-subtle">
                <span aria-hidden="true">· {c.count}</span>
                <span className="sr-only">
                  , en {c.count} {c.count === 1 ? "oferta" : "ofertas"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-fg-subtle">
          Por ahora no encontramos términos nuevos que se repitan.
        </p>
      )}
    </details>
  );
}
