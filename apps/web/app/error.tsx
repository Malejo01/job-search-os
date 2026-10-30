"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="contenido" className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16">
      <h1 className="text-xl font-semibold">Algo falló de nuestro lado</h1>
      <p className="text-sm text-fg-subtle">Probá de nuevo. Si sigue pasando, avisanos.</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex min-h-11 items-center rounded-control bg-brand px-4 py-2 text-sm font-medium text-brand-contrast"
        >
          Probar de nuevo
        </button>
        <Link
          href="/jobs"
          className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-fg"
        >
          Ir a mis ofertas
        </Link>
      </div>
      {/* Nunca error.message: puede citar datos. El digest alcanza para que lo reporten. */}
      {error.digest ? <p className="text-xs text-fg-subtle">Código: {error.digest}</p> : null}
    </main>
  );
}
