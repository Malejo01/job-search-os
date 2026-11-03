import { pricingEnabled } from "@job-search-os/pipeline";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { ActionTracker } from "@/components/action-tracker";
import { FeedbackButton } from "@/components/feedback-button";
import { MobileTabBar } from "./mobile-tabbar";
import { countFollowUps } from "@/lib/applications";
import { canUseAssistant } from "@/lib/assistant";
import { assertAppRole } from "@/lib/db";
import { canCreateInvitations } from "@/lib/invitations";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { needsTermsAcceptance } from "@/lib/terms-status";
import { getUserPlan } from "@/lib/user-plan";
import { getDisplayName } from "@/lib/display-name";
import { AssistantButton } from "./assistant-button";
import { Avatar } from "./avatar";
import { DesktopNav } from "./main-nav";
import { PlanNotice } from "./plan-notice";
import { Logo } from "@/components/brand/logo";

const NAV = [
  { href: "/hoy", label: "Hoy" },
  { href: "/jobs", label: "Ofertas" },
  { href: "/jobs/pending-jd", label: "Sin descripción" },
  { href: "/inbox", label: "Emails" },
  { href: "/applications", label: "Postulaciones" },
  { href: "/market", label: "Mercado" },
  { href: "/plan", label: "Plan" },
] as const;

// Acciones de cuenta de la barra índigo: Invitar, Asistente, Ajustes y Salir. Foco en lima de
// marca (12,4:1 sobre índigo). No son secciones: en el celular quedan arriba, chicas.
const HEADER_LINK =
  "inline-flex min-h-11 items-center text-sm font-bold text-on-ink-muted underline-offset-2 hover:text-on-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const LOGO_LINK =
  "inline-flex min-h-11 items-center rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

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
  // Aviso de vigencia del plan (C3-1): solo con los precios encendidos; si la consulta falla, no se muestra
  const planAccess = pricingEnabled(process.env)
    ? await getUserPlan(userId)
        .then((p) => p.access)
        .catch(() => null)
    : null;
  // Avatar del header (C7-5): si la consulta falla, el ícono de perfil
  const displayName = await getDisplayName(userId).catch(() => null);
  const navItems = NAV.map((item) =>
    item.href === "/applications" ? { ...item, count: followUps } : item,
  );
  return (
    // Pestañas abajo en el celular (C9-7): el pie y el último contenido quedan por encima de ellas,
    // y `--tabbar-h` sube lo que va fijo abajo (chip de soporte, acciones en lote, guardar skills)
    <div className="flex min-h-screen flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] [--tabbar-h:calc(4.25rem+env(safe-area-inset-bottom,0px))] sm:pb-0 sm:[--tabbar-h:0px]">
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      {/* Barra índigo fina (C9-7, decisión 6), igual en claro y en oscuro: logo, píldoras y cuenta.
          Hoy suma debajo su cabecera curva. z-20: las tarjetas de /jobs llevan links z-10 y no deben
          dibujarse sobre el header; la guía (z-40) y los modales (z-50) quedan arriba */}
      <header className="sticky top-0 z-20 bg-ink text-on-ink">
        {/* Desde lg las píldoras van al lado del logo; entre sm y lg pasan a su propia fila
            (`order-last basis-full`). En el celular no van: ahí están las pestañas de abajo */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-0 px-4 py-1 sm:min-h-16">
          <Link href="/hoy" className={LOGO_LINK}>
            <Logo tone="dark" />
          </Link>
          <div className="order-last basis-full lg:order-none lg:flex-1 lg:basis-auto">
            <DesktopNav items={navItems} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4">
            {canInvite ? (
              <Link href="/settings/invitations" className={HEADER_LINK}>
                Invitar
              </Link>
            ) : null}
            {canAssist ? <AssistantButton className={HEADER_LINK} /> : null}
            <Link href="/settings" className={HEADER_LINK}>
              Ajustes
            </Link>
            <form action={logout}>
              <button type="submit" className={HEADER_LINK}>
                Salir
              </button>
            </form>
            <Avatar name={displayName} />
          </div>
        </div>
      </header>
      {/* pb-24 en el celular: el chip de soporte (abajo a la derecha) no tapa el último botón */}
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-24 sm:pt-8 sm:pb-10"
      >
        {planAccess ? <PlanNotice access={planAccess} /> : null}
        {children}
      </main>
      <ActionTracker />
      <FeedbackButton />
      <MobileTabBar followUps={followUps} />
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
