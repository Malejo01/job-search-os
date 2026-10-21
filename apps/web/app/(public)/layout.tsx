import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { siteUrl } from "@/lib/site-url";

/**
 * Layout de la vitrina pública (ronda 63): portada, mercado, ofertas de muestra y pedido de acceso.
 * Sin nombre de producto a propósito: se muestra la propuesta de valor. Server Component, sin
 * sesión ni cookies, para que las páginas puedan ser ISR.
 */
const TAGLINE = "Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no";
const DESCRIPTION =
  "Cargás tu perfil, la IA lee cada aviso contra lo que sabés y lo que buscás, y vos decidís. Nunca postula por vos.";

const site = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(site),
  // `absolute`: con `default`, el título de este layout heredaba la plantilla del raíz
  // ("%s · <nombre del producto>"). Las páginas de abajo usan "%s", sin nombre.
  title: { absolute: TAGLINE, template: "%s" },
  description: DESCRIPTION,
  openGraph: { title: TAGLINE, description: DESCRIPTION, type: "website", locale: "es_AR" },
  twitter: { card: "summary_large_image", title: TAGLINE, description: DESCRIPTION },
};

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-zinc-900 focus:ring-2 focus:ring-zinc-900";
const LINK_CLASS =
  "inline-flex min-h-11 items-center px-2 text-sm text-zinc-700 underline-offset-2 hover:underline";

// Sin `inline-flex` en la base: junto con `hidden`, Tailwind deja ganar a `inline-flex` y el link se ve a 360 px
const DESKTOP_LINK_CLASS =
  "hidden min-h-11 items-center px-2 text-sm text-zinc-700 underline-offset-2 hover:underline sm:inline-flex";

// Subrayados siempre: el pie mezcla links con "·" y sin subrayado el link no se distingue del texto (link-in-text-block)
const FOOTER_LINK = "inline-flex min-h-11 items-center px-2 underline underline-offset-2";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      <header className="border-b border-zinc-200 bg-white">
        <nav
          aria-label="Principal"
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-1"
        >
          <Link href="/" className={`${LINK_CLASS} font-semibold text-zinc-900`}>
            Inicio
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1">
            {/* Mercado y Ofertas van en el pie por debajo de sm: así el header entra en una fila a 360 px */}
            <Link href="/mercado" className={DESKTOP_LINK_CLASS}>
              Mercado
            </Link>
            <Link href="/ofertas" className={DESKTOP_LINK_CLASS}>
              Ofertas
            </Link>
            <Link href="/demo" className={DESKTOP_LINK_CLASS}>
              Demo
            </Link>
            {/* A 360 px el texto largo deja el header justo en el borde: abajo de sm dice "Entrar" */}
            <Link href="/login" className={LINK_CLASS}>
              <span className="sm:hidden">Entrar</span>
              <span className="hidden sm:inline">Ya tengo cuenta</span>
            </Link>
            <Link
              href="/acceso"
              className="inline-flex min-h-11 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white"
            >
              Pedir acceso
            </Link>
          </div>
        </nav>
      </header>
      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-2 border-t border-zinc-200 px-4 py-3 text-center text-xs text-zinc-600">
        <Link href="/mercado" className={`${FOOTER_LINK} sm:hidden`}>
          Mercado
        </Link>
        <Link href="/ofertas" className={`${FOOTER_LINK} sm:hidden`}>
          Ofertas
        </Link>
        <Link href="/demo" className={`${FOOTER_LINK} sm:hidden`}>
          Demo
        </Link>
        <Link href="/legal/privacidad" className={FOOTER_LINK}>
          Privacidad
        </Link>
        <span aria-hidden="true" className="hidden sm:inline">
          {" "}
          ·{" "}
        </span>
        <Link href="/legal/terminos" className={FOOTER_LINK}>
          Términos
        </Link>
        <span aria-hidden="true" className="hidden sm:inline">
          {" "}
          ·{" "}
        </span>
        <Link href="/como-esta-hecho" className={FOOTER_LINK}>
          Cómo está hecho
        </Link>
      </footer>
    </div>
  );
}
