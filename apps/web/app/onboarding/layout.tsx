import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { assertAppRole } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { needsTermsAcceptance } from "@/lib/terms-status";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Completá tu perfil" };

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

/**
 * Layout mínimo del onboarding: vive fuera de (app) para que el gate de ese layout no entre en
 * loop, pero igual exige sesión (el middleware ya lo pide; requireUserId es el cinturón).
 */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await assertAppRole();
  const userId = await requireUserId();
  // Gate de términos (ronda 83): igual que en (app); la pantalla de re-aceptación está fuera de ambos
  if (await needsTermsAcceptance(userId)) redirect("/terminos-actualizados");
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      <header className="bg-ink text-on-ink">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
          <Logo tone="dark" />
          <form action={logout}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-on-ink-muted underline-offset-2 hover:text-on-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              Salir
            </button>
          </form>
        </div>
      </header>
      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {children}
      </main>
    </div>
  );
}
