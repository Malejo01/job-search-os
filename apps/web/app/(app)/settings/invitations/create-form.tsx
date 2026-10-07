"use client";

import { useActionState, useState } from "react";
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
          <input
            name="email"
            type="email"
            className="rounded-md border border-zinc-300 px-3 py-2 text-base"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white disabled:opacity-60"
        >
          Crear invitación
        </button>
      </form>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      ) : null}
      {state.status === "created" ? (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-900">
            Copiá el link ahora: no se vuelve a mostrar.
            {state.email ? ` Solo sirve para ${state.email}.` : ""}
          </p>
          <code className="break-all rounded bg-white px-2 py-1">{state.link}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.link).then(() => setCopied(true));
            }}
            className="self-start rounded-md border border-zinc-300 bg-white px-3 py-1"
          >
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
