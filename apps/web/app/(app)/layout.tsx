import { pricingEnabled } from "@job-search-os/pipeline";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ActionTracker } from "@/components/action-tracker";
import { AssistantMascot } from "@/components/assistant-mascot";
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
import { Avatar } from "./avatar";
import { AppBar } from "./app-bar";
import { DesktopNav } from "./main-nav";
import { PlanNotice } from "./plan-notice";
import { Logo } from "@/components/brand/logo";
import { CopyrightNotice } from "@/components/copyright-notice";
import { ThemeToggle } from "@/components/theme-toggle";

// Acciones de administración de la barra índigo (solo admins): Invitar y Asistente. Foco en lima de
// marca (12,4:1 sobre índigo). Ajustes y Salir están en Perfil, en «Más» (C10-3).
const HEADER_LINK =
  "inline-flex min-h-11 items-center text-sm font-bold text-on-ink-muted underline-offset-2 hover:text-on-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const LOGO_LINK =
  "-my-0.5 inline-flex min-h-11 shrink-0 items-center rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

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
  // Asistente (AG-3): admins con ASSISTANT_ENABLED=admin, y también los emails de
  // ASSISTANT_TESTER_EMAILS con =testers; sin el flag no hay consulta y si falla, no se muestra
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
  return (
    // Pestañas abajo en el celular (C9-7): el pie y el último contenido quedan por encima de ellas,
    // y `--tabbar-h` sube lo que va fijo abajo (chip de soporte, acciones en lote, guardar skills)
    <div className="flex min-h-screen flex-col pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] [--tabbar-h:calc(4.75rem+env(safe-area-inset-bottom,0px))] sm:pb-0 sm:[--tabbar-h:0px]">
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      {/* Barra índigo (C10-3, pantallas aprobadas el 4/11): logo, las cinco secciones en píldoras y
          el avatar. En el celular, logo y avatar (las secciones son las pestañas de abajo) */}
      <AppBar adminTools={canInvite}>
        {/* flex-wrap: con «Invitar» (solo admins) la barra del celular pasa a dos filas */}
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-7 gap-y-1 px-5 sm:px-12">
          <Link href="/hoy" className={LOGO_LINK}>
            <Logo tone="dark" />
          </Link>
          <div className="min-w-0 sm:ml-4">
            <DesktopNav followUps={followUps} />
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4">
            {canInvite ? (
              <Link href="/settings/invitations" className={HEADER_LINK}>
                Invitar
              </Link>
            ) : null}
            {/* Claro u oscuro, a mano en todas las pantallas (C10) */}
            <ThemeToggle />
            <Avatar name={displayName} />
          </div>
        </div>
      </AppBar>
      {/* pb-24 en el celular: el chip de soporte (abajo a la izquierda) y la mascota (a la derecha) no tapan el último botón.
          Con `data-ancho="completo"` (Hoy, Ofertas, el detalle) la página pone su ancho y su
          margen, como las referencias de C10 */}
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-24 sm:pt-8 sm:pb-10 has-[[data-ancho=completo]]:max-w-none! has-[[data-ancho=completo]]:p-0!"
      >
        {planAccess ? <PlanNotice access={planAccess} /> : null}
        {children}
      </main>
      <ActionTracker />
      {/* Dos botones separados: el chip de soporte abajo a la izquierda y la mascota del asistente
          abajo a la derecha (R4-15); los dos por encima de las pestañas del celular */}
      <FeedbackButton />
      {canAssist ? <AssistantMascot /> : null}
      <MobileTabBar followUps={followUps} />
      <footer className="border-t border-line px-4 py-3 text-center text-xs text-fg-subtle">
        <Link href="/legal/privacidad" className="underline-offset-2 hover:underline">
          Privacidad
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href="/legal/terminos" className="underline-offset-2 hover:underline">
          Términos
        </Link>
        <CopyrightNotice className="mt-1" />
      </footer>
    </div>
  );
}
