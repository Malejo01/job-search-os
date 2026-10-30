import { SubmitButton } from "@/app/components/submit-button";
import { evaluateNowAction } from "./actions";

/**
 * Botón "Evaluar ahora": solo si la oferta tiene descripción, todavía no tiene evaluación y no está
 * en cola. La acción vuelve a verificar todo del lado del servidor. Server Component.
 */
export function EvaluateNow({
  jobId,
  hasJd,
  evaluated,
  evaluating,
}: {
  jobId: string;
  hasJd: boolean;
  evaluated: boolean;
  evaluating: boolean;
}) {
  if (!hasJd || evaluated || evaluating) return null;
  return (
    <form action={evaluateNowAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton
        pendingLabel="Enviando…"
        className="rounded-control bg-brand px-3 py-2 text-sm font-medium text-brand-contrast"
      >
        Evaluar ahora
      </SubmitButton>
    </form>
  );
}
