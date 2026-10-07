"use client";

import { useState } from "react";

/**
 * "Copiar todo" (JS-053): deja en el portapapeles las respuestas aprobadas para pegarlas a mano
 * en el formulario de la empresa. No hay "enviar": la app no postula (ADR-004).
 */
export function CopyAllButton({ text, disabled }: { text: string; disabled: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={disabled}
      className="rounded-md border border-zinc-400 px-3 py-2 text-sm text-zinc-800 disabled:opacity-50"
    >
      {state === "copied" ? "Copiado" : state === "failed" ? "No se pudo copiar" : "Copiar todo"}
    </button>
  );
}
