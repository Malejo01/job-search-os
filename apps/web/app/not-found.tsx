import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16">
      <h1 className="text-xl font-semibold">No encontramos esta página</h1>
      <p className="text-sm text-zinc-600">
        El enlace puede estar mal escrito o la página ya no existe.
      </p>
      <Link
        href="/jobs"
        className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
      >
        Ir a las ofertas
      </Link>
    </main>
  );
}
