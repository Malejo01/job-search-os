"use client";

import Link from "next/link";
import { FullScreenState } from "@/components/full-screen-state";
import { buttonClasses } from "@/components/ui";
import { ESTADOS_TEXTOS } from "@/lib/textos-rediseno";

/**
 * Error de una pantalla de la app (R23-07): como `app/error.tsx`, pero sin logo y sin salir del
 * layout, así la barra y las pestañas siguen a mano. Nunca muestra el mensaje del error (puede citar
 * datos): el `digest` alcanza para que lo reporten.
 */
export default function AppErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = ESTADOS_TEXTOS.errorPantalla;
  return (
    <FullScreenState
      title={t.title}
      actions={
        <>
          <button type="button" onClick={() => reset()} className={buttonClasses()}>
            {t.retry}
          </button>
          <Link href="/hoy" className={buttonClasses({ variant: "secondary" })}>
            {t.home}
          </Link>
        </>
      }
      footer={
        error.digest ? <p className="text-xs text-fg-subtle">Código: {error.digest}</p> : null
      }
    >
      <p>{t.text}</p>
    </FullScreenState>
  );
}
