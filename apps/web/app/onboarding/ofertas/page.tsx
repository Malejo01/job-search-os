import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/app/(app)/jobs/auto-refresh";
import { RoleGaps } from "@/app/(app)/jobs/role-gaps";
import { EmailNudge } from "@/app/components/email-nudge";
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
      <OnboardingSteps current={3} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tus primeras ofertas</h1>
        <Link
          href="/jobs"
          className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900 sm:rounded-md sm:bg-zinc-900 sm:px-4 sm:py-2 sm:text-base sm:text-white sm:no-underline sm:focus-visible:outline-offset-2"
        >
          Ir a mis ofertas
        </Link>
      </div>
      <EmailNudge
        userId={userId}
        title="Sumá tus alertas de LinkedIn, Get on Board e Indeed"
        body="Reenviá las alertas que ya te llegan y las evaluamos junto con estas. Toma unos 5 minutos."
        cta="Conectar mis alertas"
        href="/onboarding/asistente"
      />
      {offers.length > 0 ? (
        <>
          <p className="text-sm text-zinc-700">
            Las ordenamos por lo que nos contaste. La IA evalúa las primeras ahora y el resto cuando
            lo pidas.
          </p>
          <FirstOffersList offers={offers} />
        </>
      ) : searching ? (
        <>
          <p
            role="status"
            data-testid="first-offers-searching"
            className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-700"
          >
            Estamos buscando ofertas para tus puestos. Puede tardar un par de minutos; esta página
            se actualiza sola.
          </p>
          {/* Las ofertas se asignan después de guardar el perfil: un rato de espera por si llegan */}
          <AutoRefresh active everyMs={4000} maxMs={SEARCHING_WINDOW_MINUTES * 60_000} />
        </>
      ) : (
        <div
          data-testid="first-offers-empty"
          className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-700"
        >
          <p className="font-medium text-zinc-900">Por ahora no hay ofertas para tus puestos</p>
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

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link
          href="/jobs"
          className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Ir a mis ofertas
        </Link>
      </div>
    </section>
  );
}
