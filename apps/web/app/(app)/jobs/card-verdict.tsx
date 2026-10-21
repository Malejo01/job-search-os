"use client";

import type { HumanVerdict } from "@job-search-os/pipeline";
import { useFormStatus } from "react-dom";
import { humanVerdictAction } from "./[id]/actions";

const OPTIONS: { verdict: HumanVerdict; label: string; emoji: string }[] = [
  { verdict: "de_acuerdo", label: "Me sirve la evaluación", emoji: "👍" },
  { verdict: "en_desacuerdo", label: "No me sirve la evaluación", emoji: "👎" },
];

function VerdictButton({
  label,
  emoji,
  pressed,
}: {
  label: string;
  emoji: string;
  pressed: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={label}
      aria-pressed={pressed}
      disabled={pending}
      className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md border-2 p-2 text-base leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${
        pressed
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-500 bg-white hover:border-zinc-700"
      }`}
    >
      <span aria-hidden="true">{emoji}</span>
      {pressed ? (
        <span aria-hidden="true" className="text-sm">
          ✓
        </span>
      ) : null}
    </button>
  );
}

/**
 * 👍/👎 compacto de la tarjeta (ronda 30). Va encima del link que cubre la tarjeta (z-10) para no
 * navegar; volver a tocar el apretado lo quita. El resultado vuelve por revalidatePath("/jobs").
 */
export function CardVerdict({
  jobId,
  evaluationId,
  verdict,
  tourAnchor,
}: {
  jobId: string;
  evaluationId: string;
  verdict: HumanVerdict | null;
  /** `data-tour` de la guía de /jobs (ronda 92), solo en la primera tarjeta. */
  tourAnchor?: string;
}) {
  return (
    <div className="relative z-10 flex gap-2" data-tour={tourAnchor}>
      {OPTIONS.map((o) => {
        const pressed = verdict === o.verdict;
        return (
          <form key={o.verdict} action={humanVerdictAction}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="evaluationId" value={evaluationId} />
            <input type="hidden" name="verdict" value={pressed ? "" : o.verdict} />
            <VerdictButton label={o.label} emoji={o.emoji} pressed={pressed} />
          </form>
        );
      })}
    </div>
  );
}
