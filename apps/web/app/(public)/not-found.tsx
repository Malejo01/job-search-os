import type { Metadata } from "next";
import Link from "next/link";

// 404 público (ronda 63): se muestra dentro del layout público, sin llevar a la app con sesión
export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false } };

export default function PublicNotFound() {
  return (
    <div className="flex max-w-md flex-col gap-3 py-10">
      <h1 className="text-title font-bold text-fg">No encontramos esta página</h1>
      <p className="text-sm text-fg-muted">
        El enlace puede estar mal escrito o la página ya no existe.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href="/ofertas"
          className="inline-flex min-h-11 items-center pressable edge-6 rounded-pill border-edge-brand bg-brand px-4 text-sm font-extrabold text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Ver ofertas de muestra
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm text-fg underline underline-offset-2 hover:text-fg-muted"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
