import type { Metadata } from "next";
import Link from "next/link";

// 404 público (ronda 63): se muestra dentro del layout público, sin llevar a la app con sesión
export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false } };

export default function PublicNotFound() {
  return (
    <div className="flex max-w-md flex-col gap-3 py-10">
      <h1 className="text-xl font-semibold">No encontramos esta página</h1>
      <p className="text-sm text-zinc-700">
        El enlace puede estar mal escrito o la página ya no existe.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href="/ofertas"
          className="inline-flex min-h-11 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white"
        >
          Ver ofertas de muestra
        </Link>
        <Link href="/" className="inline-flex min-h-11 items-center text-sm underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
