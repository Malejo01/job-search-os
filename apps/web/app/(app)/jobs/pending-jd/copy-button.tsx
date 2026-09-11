"use client";

import { useState } from "react";

/** Copia el snippet para Claude in Chrome al portapapeles. Client component mínimo (clipboard). */
export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("ok");
        } catch {
          setState("error");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
      className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700"
    >
      {state === "ok" ? "Copiado" : state === "error" ? "No se pudo copiar" : "Copiar instrucción"}
    </button>
  );
}
