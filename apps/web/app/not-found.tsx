import type { Metadata } from "next";
import Link from "next/link";
import { FullScreenState } from "@/components/full-screen-state";
import { buttonClasses } from "@/components/ui";

export const metadata: Metadata = { title: "Página no encontrada" };

/** 404 (F1, C9-13): ilustración, una frase clara y una salida. */
export default function NotFound() {
  return (
    <main id="contenido">
      <FullScreenState
        logo
        title="No encontramos esta página"
        actions={
          <Link href="/hoy" className={buttonClasses()}>
            Ir a Hoy
          </Link>
        }
      >
        <p>El enlace puede estar mal escrito o la página ya no existe.</p>
      </FullScreenState>
    </main>
  );
}
