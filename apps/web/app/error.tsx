"use client";

import Link from "next/link";
import { FullScreenState } from "@/components/full-screen-state";
import { buttonClasses } from "@/components/ui";

/** Error de una pantalla (F1, C9-13): ilustración, una frase clara y una salida. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="contenido">
      <FullScreenState
        logo
        title="Algo falló de nuestro lado"
        actions={
          <>
            <button type="button" onClick={() => reset()} className={buttonClasses()}>
              Probar de nuevo
            </button>
            <Link href="/jobs" className={buttonClasses({ variant: "secondary" })}>
              Ir a mis ofertas
            </Link>
          </>
        }
        footer={
          // Nunca error.message: puede citar datos. El digest alcanza para que lo reporten.
          error.digest ? <p className="text-xs text-fg-subtle">Código: {error.digest}</p> : null
        }
      >
        <p>No es algo que hiciste vos. Probá de nuevo; si sigue pasando, avisanos.</p>
      </FullScreenState>
    </main>
  );
}
