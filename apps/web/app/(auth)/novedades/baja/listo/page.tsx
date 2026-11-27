import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";
import { ALTA_TEXTOS } from "@/lib/textos-rediseno";

export const dynamic = "force-dynamic";

// Sin indexar y sin pasar el enlace (lleva el token) a ningún otro sitio
export const metadata: Metadata = {
  title: ALTA_TEXTOS.novedades.baja.titulo,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const T = ALTA_TEXTOS.novedades.baja;

/**
 * Confirmación de la baja del email de novedades (R32-09). Pública y sin sesión. Solo muestra el resultado que le
 * pasó la ruta de baja (`?r=ok|invalido|error`); cualquier otro valor se ve como «enlace inválido». No hace ninguna
 * escritura: la baja la hizo la ruta, y esto se puede recargar sin efecto.
 */
export default async function BajaListoPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const { r } = await searchParams;
  const result = r === "ok" || r === "error" ? r : "invalido";
  const view = T[result];
  return (
    <main
      id="contenido"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6"
    >
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Logo />
      </Link>
      <h1 className="text-2xl font-semibold" data-testid="novedades-baja-titulo">
        {view.titulo}
      </h1>
      <p
        role={result === "ok" ? "status" : "alert"}
        className={result === "ok" ? "text-sm text-success" : "text-sm text-danger"}
        data-testid="novedades-baja-texto"
      >
        {view.texto}
      </p>
      <Link href="/settings#novedades" className={buttonClasses({ variant: "secondary" })}>
        {T.ajustes}
      </Link>
    </main>
  );
}
