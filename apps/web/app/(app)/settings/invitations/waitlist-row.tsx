"use client";

import { useActionState, useState } from "react";
import {
  deleteFromWaitlistAction,
  inviteFromWaitlistAction,
  type WaitlistDeleteState,
  type WaitlistInviteState,
} from "./actions";

export type WaitlistRowData = {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  heardFrom: string | null;
  createdLabel: string;
  invitedLabel: string | null;
};

const INVITE_INITIAL: WaitlistInviteState = { status: "idle" };
const DELETE_INITIAL: WaitlistDeleteState = { status: "idle" };

/** Una persona de la lista de espera. Cliente solo para mostrar el link una vez y confirmar el borrado. */
export function WaitlistRow({ entry }: { entry: WaitlistRowData }) {
  const [invite, inviteAction, invitePending] = useActionState(
    inviteFromWaitlistAction,
    INVITE_INITIAL,
  );
  const [del, deleteAction, deletePending] = useActionState(
    deleteFromWaitlistAction,
    DELETE_INITIAL,
  );
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  // Recién invitada: la página todavía puede mostrarla como sin invitar hasta que revalide
  const invited = entry.invitedLabel !== null || invite.status === "created";

  return (
    <li className="flex flex-col gap-2 p-3 text-sm" data-testid="waitlist-row">
      <div className="flex flex-col">
        <span className="font-medium">{entry.name}</span>
        <span className="break-all text-zinc-600">{entry.email}</span>
        <span className="text-zinc-600">
          {entry.roleLabel}
          {entry.heardFrom ? ` · se enteró por: ${entry.heardFrom}` : ""}
        </span>
        <span className="text-zinc-600">
          Se anotó {entry.createdLabel} ·{" "}
          {entry.invitedLabel
            ? `invitada el ${entry.invitedLabel}`
            : invited
              ? "invitada"
              : "sin invitar"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!invited ? (
          <form action={inviteAction}>
            <input type="hidden" name="id" value={entry.id} />
            <button
              type="submit"
              disabled={invitePending}
              className="rounded-md bg-zinc-900 px-3 py-1 text-white disabled:opacity-60"
            >
              Crear invitación
            </button>
          </form>
        ) : null}
        {confirming ? (
          <form action={deleteAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={entry.id} />
            <button
              type="submit"
              disabled={deletePending}
              className="rounded-md border border-red-300 bg-red-50 px-3 py-1 text-red-800 disabled:opacity-60"
            >
              ¿Seguro? Borrar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-zinc-300 px-3 py-1"
            >
              Cancelar
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-zinc-300 px-3 py-1"
          >
            Borrar
          </button>
        )}
      </div>
      {confirming ? (
        <p className="text-xs text-zinc-600">Usalo si la persona pidió que borremos sus datos.</p>
      ) : null}

      {invite.status === "error" ? (
        <p role="alert" className="text-red-700">
          {invite.message}
        </p>
      ) : null}
      {del.status === "error" ? (
        <p role="alert" className="text-red-700">
          {del.message}
        </p>
      ) : null}
      {invite.status === "created" ? (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-medium text-emerald-900">
            Copiá el link ahora: no se vuelve a mostrar. Solo sirve para {invite.email}.
          </p>
          <code className="break-all rounded bg-white px-2 py-1">{invite.link}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(invite.link).then(() => setCopied(true));
            }}
            className="self-start rounded-md border border-zinc-300 bg-white px-3 py-1"
          >
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      ) : null}
    </li>
  );
}
