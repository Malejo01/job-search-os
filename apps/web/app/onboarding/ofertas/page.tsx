import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/app/(app)/jobs/auto-refresh";
import { RoleGaps } from "@/app/(app)/jobs/role-gaps";
import { EmailNudge } from "@/app/components/email-nudge";
import { GuidedTour } from "@/components/guided-tour";
import { dismissGuideAction } from "@/lib/guide-actions";
import { GUIDE_LABELS, GUIDE_STEPS } from "@/lib/guide";
import {
  getProfileUpdatedAt,
  isSearchingWindow,
  listFirstOffers,
  SEARCHING_WINDOW_MINUTES,
} from "@/lib/first-offers";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { OnboardingSteps } from "../steps";
import { FirstOffersList } from "./first-offers-list";

export const metadata = { title: "Tus primeras ofertas" };
export const dynamic = "force-dynamic";

/**
 * Paso 3 del onboarding: las primeras ofertas de las fuentes públicas, ordenadas por lo que la
 * persona contó. Sin perfil completo vuelve al paso 1. El email es opcional y viene después.
 */
export default async function FirstOffersPage() {
  const userId = await requireUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  const offers = await listFirstOffers(userId);
  const searching =
    offers.length === 0 && isSearchingWindow(await getProfileUpdatedAt(userId), new Date());

  return (
    <section className="flex flex-col gap-4">
      <OnboardingSteps
        current={3}
        guide={
          <GuidedTour
            steps={GUIDE_STEPS.ofertas}
            label={GUIDE_LABELS.panel}
            testId="guide"
            openerLabel={GUIDE_LABELS.opener}
            resume
            onDone={dismissGuideAction}
          />
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tus primeras ofertas</h1>
        <Link
          href="/jobs"
          className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus sm:rounded-control sm:bg-brand sm:px-4 sm:py-2 sm:text-base sm:text-brand-contrast sm:no-underline sm:focus-visible:outline-offset-2"
        >
          Ir a mis ofertas
        </Link>
      </div>
      {offers.length > 0 ? (
        <div data-tour="ofertas:lista" className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Las ordenamos por lo que nos contaste.
            {offers.some((o) => o.evaluating)
              ? " La IA está evaluando las primeras: el puntaje aparece en unos segundos."
              : offers.some((o) => o.score === null)
                ? " Las que tienen descripción y todavía no tienen puntaje se evalúan cuando abrís la oferta y tocás «Evaluar ahora»."
                : null}
          </p>
          <FirstOffersList offers={offers} />
        </div>
      ) : searching ? (
        <div data-tour="ofertas:lista" className="flex flex-col gap-4">
          <p
            role="status"
            data-testid="first-offers-searching"
            className="rounded-control border border-dashed border-line-strong p-4 text-sm text-fg-muted"
          >
            Estamos buscando ofertas para tus puestos. Puede tardar un par de minutos; esta página
            se actualiza sola.
          </p>
          {/* Las ofertas se asignan después de guardar el perfil: un rato de espera por si llegan */}
          <AutoRefresh active everyMs={4000} maxMs={SEARCHING_WINDOW_MINUTES * 60_000} />
        </div>
      ) : (
        <div
          data-tour="ofertas:lista"
          data-testid="first-offers-empty"
          className="flex flex-col gap-2 rounded-control border border-dashed border-line-strong p-4 text-sm text-fg-muted"
        >
          <p className="font-medium text-fg">Por ahora no hay ofertas para tus puestos</p>
          <ul className="list-disc pl-5">
            <li>
              <Link href="/jobs/new" className="underline">
                Pegá una oferta que te interese
              </Link>
            </li>
            <li>
              <Link href="/settings#puesto" className="underline">
                Revisá tus puestos en Ajustes
              </Link>
            </li>
            <li>Seguimos buscando todos los días.</li>
          </ul>
          <RoleGaps userId={userId} title={false} />
        </div>
      )}

      {/* El aviso va después de la lista: lo primero que se ve son las ofertas (C-17, R6). Sin aviso
          (ya recibió un email o dijo «No, gracias») el contenedor queda vacío y no ocupa lugar */}
      <div data-tour="ofertas:email" className="empty:hidden">
        <EmailNudge
          userId={userId}
          title="Sumá tus alertas de LinkedIn, Get on Board e Indeed"
          body="Reenviá las alertas que ya te llegan y las evaluamos junto con estas. Toma unos 5 minutos."
          cta="Conectar mis alertas"
          href="/onboarding/asistente"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link
          href="/jobs"
          data-tour="ofertas:seguir"
          className="rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Ir a mis ofertas
        </Link>
      </div>
    </section>
  );
}
