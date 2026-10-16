import type { HumanVerdict } from "@job-search-os/pipeline";
import { humanVerdictAction } from "./actions";
import { VerdictReason } from "./verdict-reason";

const TITLE = "¿Te sirve esta evaluación?";

const OPTIONS: { verdict: HumanVerdict; label: string; name: string; emoji: string }[] = [
  { verdict: "de_acuerdo", label: "Sí", name: "Sí, me sirve", emoji: "👍" },
  { verdict: "en_desacuerdo", label: "No", name: "No, no me sirve", emoji: "👎" },
];

/**
 * 👍/👎 de un toque sobre la evaluación (ronda 30). Guarda al instante con una Server Action; volver
 * a tocar el botón apretado lo quita. No es un score: no entra en el MAE ni en el snapshot.
 */
export function Verdict({
  jobId,
  evaluationId,
  verdict,
  note,
}: {
  jobId: string;
  evaluationId: string;
  verdict: HumanVerdict | null;
  note: string | null;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm">
      <h2 className="font-semibold">{TITLE}</h2>
      <div role="group" aria-label={TITLE} className="flex gap-2">
        {OPTIONS.map((o) => {
          const pressed = verdict === o.verdict;
          return (
            <form key={o.verdict} action={humanVerdictAction}>
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="evaluationId" value={evaluationId} />
              <input type="hidden" name="verdict" value={pressed ? "" : o.verdict} />
              <button
                type="submit"
                aria-label={o.name}
                aria-pressed={pressed}
                className={`flex min-h-[44px] min-w-[88px] items-center justify-center gap-2 rounded-md border-2 px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  pressed
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-500 bg-white text-zinc-800 hover:border-zinc-700"
                }`}
              >
                <span aria-hidden="true">{o.emoji}</span>
                {o.label}
                {pressed ? <span aria-hidden="true">✓</span> : null}
              </button>
            </form>
          );
        })}
      </div>
      {verdict ? <VerdictReason jobId={jobId} evaluationId={evaluationId} note={note} /> : null}
    </section>
  );
}
