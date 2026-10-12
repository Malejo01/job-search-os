import { PRODUCT_NAME } from "@job-search-os/pipeline";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Layout de las páginas legales públicas (JS-106): fuera de (app), sin sesión ni gate de
 * onboarding, para que se puedan leer antes de registrarse. Server Component.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
          <span className="text-base font-semibold">{PRODUCT_NAME}</span>
          <Link href="/login" className="text-sm text-zinc-600 underline-offset-2 hover:underline">
            Entrar
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">{children}</main>
      <footer className="border-t border-zinc-200 px-4 py-3 text-center text-xs text-zinc-500">
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
