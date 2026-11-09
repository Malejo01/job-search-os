"use client";

import { useActionState, useState } from "react";
import { buttonClasses, inputClasses } from "@/components/ui";
import { createMcpTokenAction, type CreateMcpTokenState } from "./actions";

const INITIAL: CreateMcpTokenState = { status: "idle" };

/**
 * Cliente solo para mostrar la URL una vez (vive en memoria, no en la URL de la página) y copiarla.
 * Al recargar o salir, desaparece: el servidor no la guarda.
 */
export function CreateTokenForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(createMcpTokenAction, INITIAL);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Nombre de la conexión
          <input
            name="label"
            maxLength={60}
            required
            defaultValue="ChatGPT"
            autoComplete="off"
            className={inputClasses()}
          />
        </label>
        <button type="submit" disabled={pending || disabled} className={buttonClasses()}>
          Generar token
        </button>
      </form>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
      {state.status === "created" ? (
        <div
          data-testid="mcp-token-creado"
          className="flex flex-col gap-2 rounded-control border border-warning-line bg-warning-soft p-3 text-sm"
        >
          <p className="font-bold text-warning">
            Guardalo ahora: no se vuelve a mostrar. Quien tenga esta URL puede usar tu cuenta desde
            un chat.
          </p>
          <p className="text-fg-muted">URL del servidor MCP para «{state.label}»:</p>
          <code
            data-testid="mcp-token-url"
            className="break-all rounded-badge bg-surface px-2 py-1"
          >
            {state.url}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.url).then(() => setCopied(true));
            }}
            className={buttonClasses({ variant: "secondary", size: "sm", className: "self-start" })}
          >
            {copied ? "Copiada" : "Copiar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
