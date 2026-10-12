import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/app/(app)/jobs/auto-refresh";
import { TrustBox } from "@/app/components/trust-box";
import { listFirstOffers } from "@/lib/first-offers";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
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

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Tus primeras ofertas</h1>
      {offers.length > 0 ? (
        <>
          <p className="text-sm text-zinc-700">
            Las ordenamos por lo que nos contaste. La IA evalúa las primeras ahora y el resto cuando
            lo pidas.
          </p>
          <FirstOffersList offers={offers} />
        </>
      ) : (
        <>
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-700">
            Todavía no hay ofertas para tu puesto en las fuentes públicas. Se actualizan cada 6
            horas.{" "}
            <Link href="/jobs/new" className="underline">
              Cargar una oferta a mano
            </Link>
            .
          </p>
          {/* Las ofertas se asignan después de guardar el perfil: un rato corto de espera por si llegan */}
          <AutoRefresh active everyMs={4000} maxMs={20_000} />
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link
          href="/onboarding/asistente"
          className="rounded-md border border-zinc-300 px-4 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
        >
          Conectar mis alertas de email (opcional)
        </Link>
        <Link
          href="/jobs"
          className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Ir a mis ofertas
        </Link>
      </div>

      <TrustBox />
    </section>
  );
}
