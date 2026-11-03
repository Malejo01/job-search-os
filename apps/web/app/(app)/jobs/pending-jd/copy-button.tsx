"use client";

import { useState } from "react";
import { buttonClasses } from "@/components/ui";

/** Copia un texto al portapapeles. Client component mínimo (clipboard). Ya no se usa en esta página. */
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
      className={buttonClasses({ variant: "secondary", size: "sm" })}
    >
      {state === "ok" ? "Copiado" : state === "error" ? "No se pudo copiar" : "Copiar instrucción"}
    </button>
  );
}
