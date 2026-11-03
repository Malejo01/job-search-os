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
        className="pressable edge-4 rounded-pill border-edge-brand bg-brand px-4 py-2 text-sm font-extrabold text-brand-contrast"
      >
        Evaluar ahora
      </SubmitButton>
    </form>
  );
}
