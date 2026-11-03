"use client";

import { useState } from "react";
// R-1: import directo (el barril de `@/components/ui` arrastra el de pipeline, con zod, al navegador)
import { buttonClasses } from "@/components/ui/button";

type Shared = "idle" | "copied" | "manual";

/**
 * «Pasáselo a alguien» (C8-3): Web Share en el celular; si no está o falla, copia el link; si tampoco
 * se puede copiar, lo muestra para copiarlo a mano. El link lleva `?origen=compartido` para el embudo.
 * No manda nada a ningún servidor.
 */
export function ShareButton({ brandName }: { brandName: string }) {
  const [shared, setShared] = useState<Shared>("idle");
  const [url, setUrl] = useState("");
  const text = `Me anoté en la beta de ${brandName}: lee ofertas de trabajo contra tu perfil y te dice por qué sí y por qué no. Es para 6 carreras y el cupo es limitado.`;

  async function onShare() {
    const link = `${window.location.origin}/acceso?origen=compartido`;
    setUrl(link);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: brandName, text, url: link });
        return;
      } catch (e) {
        // Cerrar el menú de compartir no es un error: no hacemos nada
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${link}`);
      setShared("copied");
    } catch {
      setShared("manual");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onShare}
        className={buttonClasses({ variant: "secondary", className: "min-h-12 w-full text-base" })}
      >
        Pasáselo a alguien
      </button>
      <p role="status" className="min-h-5 text-sm text-fg-muted">
        {shared === "copied" ? "Copiamos el link. Pegalo donde quieras." : ""}
        {shared === "manual" ? "Copiá este link y pasáselo:" : ""}
      </p>
      {shared === "manual" ? (
        <input
          readOnly
          value={url}
          aria-label="Link para compartir"
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-12 w-full rounded-control border-2 border-line-control bg-surface px-3 py-2 text-base text-fg"
        />
      ) : null}
    </div>
  );
}
