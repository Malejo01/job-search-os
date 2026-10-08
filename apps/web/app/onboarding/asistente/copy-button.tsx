"use client";

import { useState } from "react";

/** Copia la dirección al portapapeles; si el navegador lo niega, la dirección sigue seleccionable. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium"
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}
