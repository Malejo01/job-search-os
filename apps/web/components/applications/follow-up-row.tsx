import Link from "next/link";
import { buttonClasses } from "@/components/ui";
import type { FollowUpView } from "@/lib/applications";
import { STATUS_LABELS } from "@/lib/labels";
import {
  closeApplicationAction,
  snoozeFollowUpAction,
} from "@/app/(app)/applications/followup-actions";
import { ConfirmAction } from "./confirm-action";

const FOLLOW_BUTTON = buttonClasses({ variant: "secondary", size: "sm" });

/** Fila compacta de «Para hacer seguimiento» (R4-07). Conserva el testid y los textos que usan los e2e. */
export function FollowUpRow({ f }: { f: FollowUpView }) {
  return (
    <li
      data-testid="seguimiento-item"
      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <Link href={`/jobs/${f.jobId}`} className="font-bold text-fg hover:underline">
          {f.title}
        </Link>
        <p className="text-xs text-fg-subtle">
          {f.company} · {STATUS_LABELS[f.status] ?? f.status} · hace {f.daysSince}{" "}
          {f.daysSince === 1 ? "día" : "días"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={snoozeFollowUpAction.bind(null, f.jobId)}>
          <button type="submit" className={FOLLOW_BUTTON}>
            Ya hice seguimiento
          </button>
        </form>
        <Link href={`/jobs/${f.jobId}`} className={FOLLOW_BUTTON}>
          Me respondieron
        </Link>
        {/* Cerrar pide confirmación: está al lado de la acción más usada y no se deshace acá */}
        <ConfirmAction
          summary="Cerrar postulación"
          question="¿Ya no la seguís?"
          confirmLabel="Sí, cerrar"
          action={closeApplicationAction.bind(null, f.jobId)}
        />
      </div>
    </li>
  );
}
