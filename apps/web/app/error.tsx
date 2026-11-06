"use client";

import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { buttonClasses, Illustration } from "@/components/ui";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="contenido" className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16">
      <Logo className="mb-4" />
      <Illustration scene="error" className="mb-2" />
      <h1 className="text-title font-bold">Algo falló de nuestro lado</h1>
      <p className="text-sm text-fg-muted">
        No es algo que hiciste vos. Probá de nuevo; si sigue pasando, avisanos.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => reset()} className={buttonClasses()}>
          Probar de nuevo
        </button>
        <Link href="/jobs" className={buttonClasses({ variant: "secondary" })}>
          Ir a mis ofertas
        </Link>
      </div>
      {/* Nunca error.message: puede citar datos. El digest alcanza para que lo reporten. */}
      {error.digest ? <p className="text-xs text-fg-subtle">Código: {error.digest}</p> : null}
    </main>
  );
}
