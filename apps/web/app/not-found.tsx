import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { buttonClasses, Illustration } from "@/components/ui";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16">
      <Logo className="mb-4" />
      <Illustration scene="error" className="mb-2" />
      <h1 className="text-title font-bold text-fg">No encontramos esta página</h1>
      <p className="text-sm text-fg-muted">
        El enlace puede estar mal escrito o la página ya no existe.
      </p>
      <Link href="/hoy" className={buttonClasses({ className: "self-start" })}>
        Ir a Hoy
      </Link>
    </main>
  );
}
