import { BRAND, pricingEnabled } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { siteUrl } from "@/lib/site-url";
import { Logo } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui";

/**
 * Layout de la vitrina pública (ronda 63): portada, mercado, ofertas de muestra y pedido de acceso.
 * Desde C7-2 lleva la marca: el logo en el header y el nombre (`BRAND.name`) en los títulos y en lo que se
 * comparte. Server Component, sin sesión ni cookies, para que las páginas puedan ser ISR.
 */
const DESCRIPTION =
  "Cargás tu perfil, la IA lee cada aviso contra lo que sabés y lo que buscás, y vos decidís. Nunca postulamos por vos.";

const site = siteUrl();

// Portada: nombre y bajada. Las páginas de abajo: «<título> · <nombre>».
const HOME_TITLE = `${BRAND.name} · ${BRAND.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { absolute: HOME_TITLE, template: `%s · ${BRAND.name}` },
  description: DESCRIPTION,
  applicationName: BRAND.name,
  openGraph: {
    title: HOME_TITLE,
    description: DESCRIPTION,
    type: "website",
    locale: "es_AR",
    siteName: BRAND.name,
  },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: DESCRIPTION },
};

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus";
// Barra índigo sin sesión (C10-3, portada-pc.png): píldoras como las de la app (14 px 700 en
// `#C7C6E6`), «Entrar» en blanco y el botón lima. Foco en lima de marca. Miden 37 px y el área que
// se toca llega a 44 con un margen invisible.
const PILL =
  "relative items-center whitespace-nowrap rounded-pill py-[9px] text-sm leading-[1.35] font-bold before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-ink-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
// Sin `inline-flex` en la base: junto con `hidden`, Tailwind deja ganar a `inline-flex` y el link se ve a 360 px
const DESKTOP_PILL = `${PILL} hidden px-4 text-on-ink-muted hover:text-on-ink sm:inline-flex`;

// Subrayados siempre: el pie mezcla links con "·" y sin subrayado el link no se distingue del texto (link-in-text-block)
const FOOTER_LINK =
  "inline-flex min-h-11 items-center px-2 text-fg-muted underline underline-offset-2 hover:text-fg";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      <header className="bg-ink text-on-ink">
        <nav
          aria-label="Principal"
          className="mx-auto flex max-w-[1280px] items-center gap-7 px-5 py-3.5 sm:px-12 sm:py-[18px]"
        >
          <Link
            href="/"
            className="-my-0.5 inline-flex min-h-11 shrink-0 items-center rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Logo tone="dark" />
          </Link>
          <div className="hidden gap-1 sm:ml-3 sm:flex">
            <Link href="/#como-funciona" className={DESKTOP_PILL}>
              Cómo funciona
            </Link>
            {pricingEnabled(process.env) ? (
              <Link href="/precios" className={DESKTOP_PILL}>
                Precios
              </Link>
            ) : null}
            <Link href="/ayuda" className={DESKTOP_PILL}>
              Ayuda
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/login" className={`${PILL} inline-flex px-1 text-on-ink sm:px-4`}>
              Entrar
            </Link>
            {/* En el celular el botón está en la página: la barra lleva solo «Entrar» */}
            <span className="hidden sm:block">
              <Link
                href="/acceso"
                className={buttonClasses({ size: "sm", className: "focus-visible:outline-brand" })}
              >
                Anotarme a la beta
              </Link>
            </span>
          </div>
        </nav>
      </header>
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-12 sm:pt-10"
      >
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-2 border-t border-line px-4 py-3 text-center text-xs text-fg-muted">
        <Link href="/mercado" className={FOOTER_LINK}>
          Mercado
        </Link>
        <Link href="/ofertas" className={FOOTER_LINK}>
          Ofertas
        </Link>
        <Link href="/demo" className={FOOTER_LINK}>
          Demo
        </Link>
        <Link href="/ayuda" className={FOOTER_LINK}>
          Preguntas frecuentes
        </Link>
        <span aria-hidden="true" className="hidden sm:inline">
          {" "}
          ·{" "}
        </span>
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
