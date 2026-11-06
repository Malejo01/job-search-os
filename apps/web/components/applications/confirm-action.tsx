import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui";

/**
 * Confirmación en dos pasos sin JavaScript: un `details` con el aviso y el botón que dispara la
 * action (cierre, descarte). Mismo patrón que «Cerrar postulación» en el seguimiento.
 */
export function ConfirmAction({
  summary,
  question,
  confirmLabel,
  action,
  children,
  className,
}: {
  summary: string;
  question: string;
  confirmLabel: string;
  action: (formData: FormData) => void | Promise<void>;
  /** Campos ocultos para las actions que leen FormData. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <details className={className}>
      <summary className="flex min-h-11 cursor-pointer items-center px-2 text-sm text-fg-subtle underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
        {summary}
      </summary>
      <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
        {children}
        <span className="text-xs text-fg-muted">{question}</span>
        <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {confirmLabel}
        </button>
      </form>
    </details>
  );
}
