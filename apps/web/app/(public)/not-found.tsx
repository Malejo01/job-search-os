import type { Metadata } from "next";
import Link from "next/link";
import { FullScreenState } from "@/components/full-screen-state";
import { buttonClasses } from "@/components/ui";

// 404 público (ronda 63; F1 en C9-13): dentro del layout público, sin llevar a la app con sesión
export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false } };

export default function PublicNotFound() {
  return (
    <FullScreenState
      title="No encontramos esta página"
      actions={
        <>
          <Link href="/ofertas" className={buttonClasses()}>
            Ver ofertas de muestra
          </Link>
          <Link href="/" className={buttonClasses({ variant: "ghost" })}>
            Volver al inicio
          </Link>
        </>
      }
    >
      <p>El enlace puede estar mal escrito o la página ya no existe.</p>
    </FullScreenState>
  );
}
