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
export function ShareButton({
  brandName,
  compact = false,
}: {
  brandName: string;
  /** Al lado de «Anotarme» (C10-5): ancho justo, 50 px, con el aviso de «copiado» flotando abajo. */
  compact?: boolean;
}) {
  const [shared, setShared] = useState<Shared>("idle");
  const [url, setUrl] = useState("");
  const text = `Me anoté en la beta de ${brandName}: lee ofertas de trabajo contra tu perfil y te dice por qué sí y por qué no. Es para 8 carreras y el cupo es limitado.`;

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
    <div className={compact ? "relative" : "flex flex-col gap-2"}>
      <button
        type="button"
        onClick={onShare}
        className={
          compact
            ? buttonClasses({ variant: "secondary", size: "mid" })
            : buttonClasses({ variant: "secondary", className: "min-h-12 w-full text-base" })
        }
      >
        Pasáselo a alguien
      </button>
      {/* Al lado de «Anotarme», sin `role="status"`: el estado de la página es el del formulario */}
      <p
        role={compact ? undefined : "status"}
        aria-live={compact ? "polite" : undefined}
        className={
          compact
            ? "absolute top-full left-0 mt-1 w-max text-xs text-fg-muted"
            : "min-h-5 text-sm text-fg-muted"
        }
      >
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
