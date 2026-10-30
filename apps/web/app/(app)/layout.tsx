import { PRODUCT_NAME } from "@job-search-os/pipeline";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { FeedbackButton } from "@/components/feedback-button";
import { countFollowUps } from "@/lib/applications";
import { canUseAssistant } from "@/lib/assistant";
import { assertAppRole } from "@/lib/db";
import { canCreateInvitations } from "@/lib/invitations";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { needsTermsAcceptance } from "@/lib/terms-status";
import { AssistantButton } from "./assistant-button";
import { MainNav } from "./main-nav";

const NAV = [
  { href: "/hoy", label: "Hoy" },
  { href: "/jobs", label: "Ofertas" },
  { href: "/jobs/pending-jd", label: "Sin descripción" },
  { href: "/inbox", label: "Emails" },
  { href: "/applications", label: "Postulaciones" },
  { href: "/market", label: "Mercado" },
  { href: "/plan", label: "Plan" },
] as const;

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

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
  // Gate de términos (ronda 83): sin la versión vigente aceptada no se ve nada. La pantalla está fuera
  // de este grupo; si estuviera adentro, este redirect entraría en loop.
  if (await needsTermsAcceptance(userId)) redirect("/terminos-actualizados");
  // Gate de onboarding (B2): sin perfil completo no se ve nada de la app. /onboarding está fuera
  // de este grupo; si estuviera adentro, este redirect entraría en loop.
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  // Solo los admins ven "Invitar". Sin ADMIN_EMAILS no hay consulta; si el chequeo falla, el
  // layout no se rompe: el link no se muestra.
  const canInvite = process.env.ADMIN_EMAILS
    ? await canCreateInvitations(userId).catch(() => false)
    : false;
  // Asistente (AG-3): solo admins con ASSISTANT_ENABLED=admin; sin el flag no hay consulta y si
  // falla, no se muestra
  const canAssist = await canUseAssistant(userId);
  // Contador de «Postulaciones»: si la consulta falla, el menú se muestra igual, sin número
  const followUps = await countFollowUps(userId, new Date()).catch(() => 0);
  const navItems = NAV.map((item) =>
    item.href === "/applications" ? { ...item, count: followUps } : item,
  );
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      {/* z-20: las tarjetas de /jobs llevan links z-10 y no deben dibujarse sobre el header; la guía (z-40) y los modales (z-50) quedan arriba */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
          <Link href="/hoy" className="text-base font-semibold">
            {PRODUCT_NAME}
          </Link>
          <div className="flex flex-wrap items-center gap-x-4">
            {" "}
            {canInvite ? (
              <Link
                href="/settings/invitations"
                className="text-sm text-fg-subtle underline-offset-2 hover:underline"
              >
                Invitar
              </Link>
            ) : null}
            {canAssist ? <AssistantButton /> : null}
            <FeedbackButton />
            <Link
              href="/settings"
              className="text-sm text-fg-subtle underline-offset-2 hover:underline"
            >
              Ajustes
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="text-sm text-fg-subtle underline-offset-2 hover:underline"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
        {/* A 360 px seis links no entran en una fila: por debajo de `sm` van en un menú desplegable */}
        <div className="mx-auto max-w-5xl">
          <MainNav items={navItems} />
        </div>
      </header>
      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">
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
