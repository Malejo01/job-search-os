import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

/**
 * Layout de las páginas legales públicas (JS-106): fuera de (app), sin sesión ni gate de
 * onboarding, para que se puedan leer antes de registrarse. Server Component.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      <header className="bg-ink text-on-ink">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Logo tone="dark" />
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-on-ink-muted underline-offset-2 hover:text-on-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Entrar
          </Link>
        </div>
      </header>
      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {children}
      </main>
      <footer className="border-t border-line px-4 py-3 text-center text-xs text-fg-subtle">
        <Link href="/legal/privacidad" className="underline-offset-2 hover:underline">
          Privacidad
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href="/legal/terminos" className="underline-offset-2 hover:underline">
          Términos
        </Link>
      </footer>
    </div>
  );
}
