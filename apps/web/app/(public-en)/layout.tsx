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
  // La imagen en inglés es el route handler `opengraph-image-en/route.tsx` (ronda 122)
  openGraph: {
    title: TAGLINE,
    description: DESCRIPTION,
    type: "website",
    locale: "en_US",
    images: [{ url: "/opengraph-image-en", width: 1200, height: 630, alt: TAGLINE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TAGLINE,
    description: DESCRIPTION,
    images: ["/opengraph-image-en"],
  },
};

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus";
const LINK_CLASS =
  "inline-flex min-h-11 items-center px-2 text-sm text-fg-muted underline-offset-2 hover:underline hover:text-fg";

// Sin `inline-flex` en la base: junto con `hidden`, Tailwind deja ganar a `inline-flex` y el link se ve a 360 px
const DESKTOP_LINK_CLASS =
  "hidden min-h-11 items-center px-2 text-sm text-fg-muted underline-offset-2 hover:underline hover:text-fg sm:inline-flex";

const FOOTER_LINK =
  "inline-flex min-h-11 items-center px-2 text-fg-muted underline underline-offset-2 hover:text-fg";

export default function PublicEnLayout({ children }: { children: ReactNode }) {
  return (
    <div lang="en" className="flex min-h-screen flex-col bg-surface text-fg">
      <a href="#content" className={SKIP_CLASS}>
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-1"
        >
          <Link href="/" hrefLang="es" lang="es" className={`${LINK_CLASS} font-semibold text-fg`}>
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
              className="inline-flex min-h-11 items-center rounded-control bg-brand px-4 text-sm font-medium text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span lang="en">Request access</span>
            </Link>
          </div>
        </nav>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-2 border-t border-line px-4 py-3 text-center text-xs text-fg-muted">
        <Link href="/mercado" hrefLang="es" lang="es" className={`${FOOTER_LINK} sm:hidden`}>
          <span lang="en">Market</span>
        </Link>
        <Link href="/ofertas" hrefLang="es" lang="es" className={`${FOOTER_LINK} sm:hidden`}>
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
