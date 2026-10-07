import type { SkillCandidate } from "@/lib/market";

/** Términos frecuentes fuera de la taxonomía: propuesta, no entra a la demanda. */
export function SkillCandidates({ candidates }: { candidates: SkillCandidate[] }) {
  return (
    <details className="rounded-md border border-zinc-200 p-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
        Candidatos a skill nueva ({candidates.length})
      </summary>
      <p className="mt-2 text-xs text-zinc-600">
        Términos frecuentes en los avisos que no están en la taxonomía. No cuentan en la demanda
        hasta que se agreguen.
      </p>
      {candidates.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {candidates.map((c) => (
            <li
              key={c.term}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800"
            >
              {c.term} <span className="tabular-nums text-zinc-600">· {c.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-zinc-600">— sin candidatos por ahora —</p>
      )}
    </details>
  );
}
