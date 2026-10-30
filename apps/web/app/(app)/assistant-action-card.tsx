"use client";

import type { ActionProposal, ManualJobEvent } from "@job-search-os/pipeline";
import Link from "next/link";
import { useEffect, useId, useState, useTransition, type FormEvent } from "react";
import { SubmitButton } from "@/app/components/submit-button";
import { PROPOSAL_MAX_AGE_MS } from "@/components/assistant-proposal";
import {
  assistantChangeStatusAction,
  assistantCreateJobAction,
  type AssistantCreateJobResult,
  type AssistantStatusResult,
} from "./assistant-actions";
import { JobFields } from "./jobs/new/job-fields";

export type ActionStatus = "pendiente" | "enviada" | "descartada";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const EVENT_BUTTON: Record<ManualJobEvent, string> = {
  apply: "Marcar como aplicada",
  interview: "Marcar entrevista",
  offer: "Marcar oferta",
  reject: "Marcar rechazada",
  auto_reject: "Marcar rechazo automático",
  discard: "Descartar la oferta",
  close: "Cerrar la oferta",
};

type StatusError = Extract<AssistantStatusResult, { ok: false }>;
type CreateError = Extract<AssistantCreateJobResult, { ok: false }>;

function statusErrorText(e: StatusError): string {
  switch (e.code) {
    case "cambio_estado":
      return e.currentLabel
        ? `La oferta cambió a ${e.currentLabel}; pedile al asistente una nueva.`
        : "La oferta cambió; pedile al asistente una nueva.";
    case "transicion":
      return "Ese cambio ya no vale desde el estado de la oferta. Pedile al asistente una nueva.";
    case "sesion":
      return "Tu sesión venció. Volvé a entrar y probá de nuevo.";
    case "evento":
      return "No se pudo hacer el cambio. Hacelo desde la pantalla de la oferta.";
  }
}

const CREATE_ERROR: Record<CreateError["code"], string> = {
  campos: "Faltan el título o la empresa.",
  url: "El link no es válido. Corregilo o borralo.",
  larga: "Algún campo es demasiado largo. Acortalo y probá de nuevo.",
  ingesta: "No se pudo cargar la oferta. Probá de nuevo en un rato.",
  sesion: "Tu sesión venció. Volvé a entrar y probá de nuevo.",
};

/**
 * Tarjeta-formulario de una acción (AG-5). No hace nada hasta el clic de la persona: el botón
 * envía el formulario a una Server Action que comparte el núcleo con la de siempre y vuelve un
 * resultado (no redirige): si falla, el error aparece acá y lo escrito queda. Los textos (título,
 * empresa, oración) van como texto de React, nunca como HTML. «Aplicada» solo marca el estado: el
 * sistema nunca postula por la persona (ADR-004). Vence a los 10 minutos de llegar.
 */
export function AssistantActionCard({
  action,
  status,
  receivedAt,
  onSent,
  onDiscard,
  statusRef,
}: {
  action: ActionProposal;
  status: ActionStatus;
  /** Cuándo llegó al navegador (vence a los 10 minutos). */
  receivedAt: number;
  /** La Server Action volvió bien: `jobId` es la oferta cambiada o la recién cargada. */
  onSent: (result: { jobId: string; toLabel?: string }) => void;
  onDiscard: () => void;
  statusRef?: (el: HTMLElement | null) => void;
}) {
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentJobId, setSentJobId] = useState<string | null>(null);
  const [doneLabel, setDoneLabel] = useState<string | null>(null);
  const [expired, setExpired] = useState(() => Date.now() - receivedAt > PROPOSAL_MAX_AGE_MS);

  useEffect(() => {
    if (expired || status !== "pendiente") return;
    const left = PROPOSAL_MAX_AGE_MS - (Date.now() - receivedAt);
    const t = setTimeout(() => setExpired(true), Math.max(0, left));
    return () => clearTimeout(t);
  }, [expired, receivedAt, status]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    // A mano y no con `action={…}`: React vacía el formulario al terminar una acción, y si falla
    // la persona tiene que conservar lo que escribió
    e.preventDefault();
    if (Date.now() - receivedAt > PROPOSAL_MAX_AGE_MS) {
      setExpired(true);
      return;
    }
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        if (action.kind === "status_change") {
          const r = await assistantChangeStatusAction(formData);
          if (r.ok) {
            setSentJobId(action.jobId);
            setDoneLabel(r.toLabel);
            onSent({ jobId: action.jobId, toLabel: r.toLabel });
          } else setError(statusErrorText(r));
        } else {
          const r = await assistantCreateJobAction(formData);
          if (r.ok) {
            setSentJobId(r.jobId);
            onSent({ jobId: r.jobId });
          } else setError(CREATE_ERROR[r.code]);
        }
      } catch {
        setError("No se pudo hacer. Probá de nuevo en un rato.");
      }
    });
  }

  const discardButton = (
    <button
      type="button"
      onClick={onDiscard}
      disabled={pending}
      className={`min-h-11 rounded-control border border-line-strong px-3 py-2 text-sm font-medium text-fg disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
    >
      {action.kind === "new_job" ? "No cargar" : "Descartar"}
    </button>
  );

  const errorBox = error ? (
    <p role="alert" className="rounded-control bg-danger-soft px-2 py-1.5 text-xs text-danger">
      {error}
    </p>
  ) : null;

  const footer =
    status === "descartada" ? (
      <p ref={statusRef} tabIndex={-1} className="text-xs text-fg-muted">
        Descartada. No se cambió nada.
      </p>
    ) : status === "enviada" ? (
      <p ref={statusRef} tabIndex={-1} className="text-xs text-fg-muted">
        {action.kind === "status_change"
          ? `Listo: la oferta quedó en ${doneLabel ?? action.toLabel}.`
          : "Listo: la oferta quedó cargada. La evaluamos en un rato."}{" "}
        {sentJobId ? (
          <Link href={`/jobs/${sentJobId}`} className="underline underline-offset-2">
            Ver la oferta
          </Link>
        ) : null}
      </p>
    ) : expired ? (
      <p className="text-xs text-fg-muted">Esta tarjeta venció; pedile una nueva.</p>
    ) : null;

  if (action.kind === "status_change") {
    return (
      <section
        aria-labelledby={titleId}
        data-testid="assistant-action"
        className="flex flex-col gap-2 rounded-card border border-success-line bg-surface p-3 text-sm"
      >
        <h3 id={titleId} className="font-semibold break-words">
          Cambio de estado propuesto
        </h3>
        <p className="break-words">{action.jobLabel}</p>
        <p className="break-words">
          <span className="text-fg-subtle">Ahora:</span> {action.fromLabel}{" "}
          <span aria-hidden="true">→</span>
          <span className="sr-only">pasaría a</span>{" "}
          <span className="font-medium">{action.toLabel}</span>
        </p>
        {action.event === "apply" ? (
          <p className="text-xs text-fg-muted">
            Solo marca el estado en la app: el sistema nunca postula por vos.
          </p>
        ) : null}
        <p className="text-xs break-words text-fg-muted">
          <span className="text-fg-subtle">De dónde sale:</span> «{action.sentence}», de lo que
          escribiste
        </p>
        {status === "pendiente" && !expired ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <input type="hidden" name="jobId" value={action.jobId} />
            <input type="hidden" name="event" value={action.event} />
            <input type="hidden" name="expectedStatus" value={action.fromStatus} />
            {errorBox}
            <div className="flex flex-wrap gap-2">
              <SubmitButton
                pending={pending}
                pendingLabel="Guardando…"
                className={`min-h-11 rounded-control bg-brand hover:bg-brand-hover px-3 py-2 text-sm font-medium text-brand-contrast ${FOCUS_RING}`}
              >
                {EVENT_BUTTON[action.event]}
              </SubmitButton>
              {discardButton}
            </div>
          </form>
        ) : (
          footer
        )}
      </section>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      data-testid="assistant-action"
      className="flex flex-col gap-2 rounded-card border border-success-line bg-surface p-3 text-sm"
    >
      <h3 id={titleId} className="font-semibold break-words">
        Oferta para cargar
      </h3>
      <p className="text-xs text-fg-muted">
        Revisá los datos. No se carga nada hasta que toques «Agregar la oferta». Si pegás la
        descripción, la evaluamos en un rato.
      </p>
      <p className="text-xs break-words text-fg-muted">
        <span className="text-fg-subtle">De dónde sale:</span> «{action.source.quote}», de lo que
        escribiste
      </p>
      {status === "pendiente" && !expired ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <fieldset disabled={pending} className="contents">
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
              pending={pending}
              secondaryAction={discardButton}
            />
          </fieldset>
          {errorBox}
        </form>
      ) : (
        footer
      )}
    </section>
  );
}
