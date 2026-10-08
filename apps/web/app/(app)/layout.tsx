import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { assertAppRole } from "@/lib/db";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";

const NAV = [
  { href: "/jobs", label: "Ofertas" },
  { href: "/jobs/pending-jd", label: "Pendientes de JD" },
  { href: "/inbox", label: "Emails" },
  { href: "/applications", label: "Postulaciones" },
  { href: "/market", label: "Mercado" },
  { href: "/plan", label: "Plan" },
] as const;

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

/**
 * Layout de la app con sesión: nav mobile-first (390 px), Server Component.
 * assertAppRole corre acá (una vez por proceso) y no en instrumentation.ts: Next compila
 * instrumentation también para edge y el cliente de Postgres no entra en ese bundle.
 * En serverless "arranque" = primer request del proceso; si el rol puede saltear RLS, falla a la vista.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await assertAppRole();
  const userId = await requireUserId();
  // Gate de onboarding (B2): sin perfil completo no se ve nada de la app. /onboarding está fuera
  // de este grupo; si estuviera adentro, este redirect entraría en loop.
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <Link href="/jobs" className="text-base font-semibold">
            Job Search OS
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className="text-sm text-zinc-600 underline-offset-2 hover:underline"
            >
              Ajustes
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="text-sm text-zinc-600 underline-offset-2 hover:underline"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
        {/* A 375 px no entran todos los ítems: scroll horizontal y un degradé en el borde derecho
            avisa que hay más (solo en pantallas chicas; el pr-8 deja el último ítem fuera del degradé). */}
        <div className="relative mx-auto max-w-5xl">
          <nav aria-label="Secciones" className="overflow-x-auto px-2">
            <ul className="flex gap-1 pr-8 text-sm sm:pr-0">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block whitespace-nowrap rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden"
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">{children}</main>
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
