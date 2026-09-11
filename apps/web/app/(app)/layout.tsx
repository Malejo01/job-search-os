import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { assertAppRole } from "@/lib/db";
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
  await requireUserId();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <Link href="/jobs" className="text-base font-semibold">
            Job Search OS
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
        <nav aria-label="Secciones" className="mx-auto max-w-5xl overflow-x-auto px-2">
          <ul className="flex gap-1 text-sm">
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
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">{children}</main>
    </div>
  );
}
