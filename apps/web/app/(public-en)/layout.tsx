import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { siteUrl } from "@/lib/site-url";

/**
 * Layout de la vitrina pública en inglés (ronda 96): copia de `(public)/layout.tsx` con cabecera y
 * pie en inglés. Los destinos que solo existen en español llevan `lang="es"` y `hrefLang="es"`.
 * Server Component, sin sesión ni cookies, para que las páginas puedan ser ISR.
 */
const TAGLINE = "We read each job posting against your profile and tell you why or why not";
const DESCRIPTION =
  "You load your profile, the AI reads each posting against what you know and what you look for, and you decide. It never applies for you.";

const site = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { absolute: TAGLINE, template: "%s" },
  description: DESCRIPTION,
  // La imagen vive en `(public)/opengraph-image.tsx` (ruta /opengraph-image): este grupo no la hereda
  openGraph: {
    title: TAGLINE,
    description: DESCRIPTION,
    type: "website",
    locale: "en_US",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: TAGLINE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-zinc-900 focus:ring-2 focus:ring-zinc-900";
const LINK_CLASS =
  "inline-flex min-h-11 items-center px-2 text-sm text-zinc-700 underline-offset-2 hover:underline";

// Sin `inline-flex` en la base: junto con `hidden`, Tailwind deja ganar a `inline-flex` y el link se ve a 360 px
const DESKTOP_LINK_CLASS =
  "hidden min-h-11 items-center px-2 text-sm text-zinc-700 underline-offset-2 hover:underline sm:inline-flex";

const FOOTER_LINK = "inline-flex min-h-11 items-center px-2 underline-offset-2 hover:underline";

export default function PublicEnLayout({ children }: { children: ReactNode }) {
  return (
    <div lang="en" className="flex min-h-screen flex-col">
      <a href="#content" className={SKIP_CLASS}>
        Skip to content
      </a>
      <header className="border-b border-zinc-200 bg-white">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-1"
        >
          <Link
            href="/"
            hrefLang="es"
            lang="es"
            className={`${LINK_CLASS} font-semibold text-zinc-900`}
          >
            <span lang="en">Home</span>
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1">
            {/* Market, Postings y Demo van en el pie por debajo de sm: así el header entra en una fila a 360 px */}
            <Link href="/mercado" hrefLang="es" lang="es" className={DESKTOP_LINK_CLASS}>
              <span lang="en">Market</span>
            </Link>
            <Link href="/ofertas" hrefLang="es" lang="es" className={DESKTOP_LINK_CLASS}>
              <span lang="en">Postings</span>
            </Link>
            <Link href="/demo" hrefLang="es" lang="es" className={DESKTOP_LINK_CLASS}>
              <span lang="en">Demo</span>
            </Link>
            <Link href="/login" hrefLang="es" lang="es" className={LINK_CLASS}>
              <span lang="en">Log in</span>
            </Link>
            <Link
              href="/acceso"
              hrefLang="es"
              lang="es"
              className="inline-flex min-h-11 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white"
            >
              <span lang="en">Request access</span>
            </Link>
          </div>
        </nav>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-2 border-t border-zinc-200 px-4 py-3 text-center text-xs text-zinc-600">
        <Link
          href="/mercado"
          hrefLang="es"
          lang="es"
          className={`${FOOTER_LINK} sm:hidden`}
        >
          <span lang="en">Market</span>
        </Link>
        <Link
          href="/ofertas"
          hrefLang="es"
          lang="es"
          className={`${FOOTER_LINK} sm:hidden`}
        >
          <span lang="en">Postings</span>
        </Link>
        <Link href="/demo" hrefLang="es" lang="es" className={`${FOOTER_LINK} sm:hidden`}>
          <span lang="en">Demo</span>
        </Link>
        <Link href="/legal/privacidad" hrefLang="es" lang="es" className={FOOTER_LINK}>
          <span lang="en">Privacy</span>
        </Link>
        <span aria-hidden="true" className="hidden sm:inline">
          {" "}
          ·{" "}
        </span>
        <Link href="/legal/terminos" hrefLang="es" lang="es" className={FOOTER_LINK}>
          <span lang="en">Terms</span>
        </Link>
        <span aria-hidden="true" className="hidden sm:inline">
          {" "}
          ·{" "}
        </span>
        <Link href="/en/how-its-built" hrefLang="en" className={FOOTER_LINK}>
          How it&apos;s built
        </Link>
      </footer>
    </div>
  );
}
