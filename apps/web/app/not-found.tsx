import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16">
      <h1 className="text-xl font-semibold text-fg">No encontramos esta página</h1>
      <p className="text-sm text-fg-subtle">
        El enlace puede estar mal escrito o la página ya no existe.
      </p>
      <Link
        href="/jobs"
        className="w-fit rounded-control bg-brand px-4 py-2 text-sm font-medium text-brand-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Ir a las ofertas
      </Link>
    </main>
  );
}
