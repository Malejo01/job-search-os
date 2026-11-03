"use client";

import { useActionState, useState } from "react";
import { buttonClasses, inputClasses } from "@/components/ui";
import { createInvitationAction, type CreateInvitationState } from "./actions";

const INITIAL: CreateInvitationState = { status: "idle" };

/** Cliente solo para mostrar el link una vez (vive en memoria, no en la URL) y copiarlo. */
export function CreateInvitationForm() {
  const [state, action, pending] = useActionState(createInvitationAction, INITIAL);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Email (opcional): si lo ponés, solo ese email puede usarla
          <input name="email" type="email" className={inputClasses()} />
        </label>
        <button type="submit" disabled={pending} className={buttonClasses()}>
          Crear invitación
        </button>
      </form>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
      {state.status === "created" ? (
        <div className="flex flex-col gap-2 rounded-control border border-success-line bg-success-soft p-3 text-sm">
          <p className="font-medium text-success">
            Copiá el link ahora: no se vuelve a mostrar.
            {state.email ? ` Solo sirve para ${state.email}.` : ""}
          </p>
          <code className="break-all rounded-badge bg-surface px-2 py-1">{state.link}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.link).then(() => setCopied(true));
            }}
            className={buttonClasses({ variant: "secondary", size: "sm", className: "self-start" })}
          >
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
