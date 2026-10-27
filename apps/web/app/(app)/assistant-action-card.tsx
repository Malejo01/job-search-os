"use client";

import type { ActionProposal } from "@job-search-os/pipeline";
import Link from "next/link";
import { SubmitButton } from "@/app/components/submit-button";
import { changeStatusAction } from "./jobs/[id]/actions";
import { createManualJobAction } from "./jobs/new/actions";
import { JobFields } from "./jobs/new/job-fields";

export type ActionStatus = "pendiente" | "enviada" | "descartada";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

const EVENT_BUTTON: Record<string, string> = {
  apply: "Marcar como aplicada",
  interview: "Marcar entrevista",
  offer: "Marcar oferta",
  reject: "Marcar rechazada",
  auto_reject: "Marcar rechazo automático",
  discard: "Descartar la oferta",
  close: "Cerrar la oferta",
};

/**
 * Tarjeta-formulario de una acción (AG-5). No hace nada hasta el clic de la persona: el botón envía
 * el formulario a la Server Action de siempre (`changeStatusAction` del detalle de la oferta o
 * `createManualJobAction` del alta manual), que valida todo de nuevo. Los textos (título, empresa,
 * cita) van como texto de React, nunca como HTML. «Aplicada» solo marca el estado: el sistema
 * nunca postula por la persona (ADR-004).
 */
export function AssistantActionCard({
  action,
  status,
  onSent,
  onDiscard,
  statusRef,
}: {
  action: ActionProposal;
  status: ActionStatus;
  /** Estado: se llama cuando el cambio de estado volvió bien, o al enviar el alta (que redirige). */
  onSent: () => void;
  onDiscard: () => void;
  statusRef?: (el: HTMLElement | null) => void;
}) {
  const discardButton = (
    <button
      type="button"
      onClick={onDiscard}
      className={`min-h-11 rounded-md border border-zinc-400 px-3 py-2 text-sm font-medium text-zinc-900 ${FOCUS_RING}`}
    >
      {action.kind === "new_job" ? "No cargar" : "Descartar"}
    </button>
  );

  const quote = (
    <p className="text-xs break-words text-zinc-700">
      <span className="text-zinc-600">De dónde sale:</span> «{action.source.quote}», de lo que
      escribiste
    </p>
  );

  const done =
    status === "pendiente" ? null : (
      <p ref={statusRef} tabIndex={-1} className="text-xs text-zinc-700">
        {status === "descartada"
          ? "Descartada. No se cambió nada."
          : action.kind === "status_change"
            ? "Listo: lo guardó la pantalla de la oferta."
            : "Enviada: la oferta se carga en «Ofertas»."}
        {status === "enviada" && action.kind === "status_change" ? (
          <>
            {" "}
            <Link href={`/jobs/${action.jobId}`} className="underline underline-offset-2">
              Ver la oferta
            </Link>
          </>
        ) : null}
      </p>
    );

  if (action.kind === "status_change") {
    return (
      <section
        aria-label="Cambio de estado propuesto"
        data-testid="assistant-action"
        className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-white p-3 text-sm"
      >
        <h3 className="font-semibold break-words">Cambio de estado propuesto</h3>
        <p className="break-words">{action.jobLabel}</p>
        <p className="break-words">
          <span className="text-zinc-600">Ahora:</span> {action.fromLabel}{" "}
          <span aria-hidden="true">→</span>
          <span className="sr-only">pasaría a</span>{" "}
          <span className="font-medium">{action.toLabel}</span>
        </p>
        {action.event === "apply" ? (
          <p className="text-xs text-zinc-700">
            Solo marca el estado en la app: el sistema nunca postula por vos.
          </p>
        ) : null}
        {quote}
        {status === "pendiente" ? (
          <form
            action={async (formData) => {
              // Si la transición no vale, la acción redirige al detalle con el error de siempre
              await changeStatusAction(formData);
              onSent();
            }}
            className="flex flex-wrap gap-2"
          >
            <input type="hidden" name="jobId" value={action.jobId} />
            <input type="hidden" name="event" value={action.event} />
            <SubmitButton
              pendingLabel="Guardando…"
              className={`min-h-11 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white ${FOCUS_RING}`}
            >
              {EVENT_BUTTON[action.event] ?? "Confirmar"}
            </SubmitButton>
            {discardButton}
          </form>
        ) : (
          done
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Oferta para cargar"
      data-testid="assistant-action"
      className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-white p-3 text-sm"
    >
      <h3 className="font-semibold break-words">Oferta para cargar</h3>
      <p className="text-xs text-zinc-700">
        Revisá los datos. No se carga nada hasta que toques «Agregar la oferta».
      </p>
      {quote}
      {status === "pendiente" ? (
        <form
          action={async (formData) => {
            // El alta siempre redirige (al detalle de la oferta o a /jobs/new con el error)
            onSent();
            await createManualJobAction(formData);
          }}
          className="flex flex-col gap-3"
        >
          <JobFields
            defaults={{
              title: action.fields.title,
              company: action.fields.company,
              url: action.fields.url,
              location: action.fields.location,
              modality: action.fields.modality,
            }}
            submitLabel="Agregar la oferta"
            pendingLabel="Agregando…"
            secondaryAction={discardButton}
          />
        </form>
      ) : (
        done
      )}
    </section>
  );
}
