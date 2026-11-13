import type { Metadata } from "next";
import Link from "next/link";
import { FullScreenState } from "@/components/full-screen-state";
import { buttonClasses } from "@/components/ui";

export const metadata: Metadata = { title: "Página no encontrada" };

/**
 * 404 (F1, C9-13): ilustración, una frase clara y una salida. La salida es «/» para todos, sin leer la
 * sesión (el 404 se prerenderiza): con sesión el middleware redirige a /hoy; sin sesión es la portada.
 */
export default function NotFound() {
  return (
    <main id="contenido">
      <FullScreenState
        logo
        title="No encontramos esta página"
        actions={
          <Link href="/" className={buttonClasses()}>
            Ir al inicio
          </Link>
        }
      >
        <p>El enlace puede estar mal escrito o la página ya no existe.</p>
      </FullScreenState>
    </main>
  );
}
