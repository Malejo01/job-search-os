import type { Metadata } from "next";
import { contactLink } from "@/lib/contact";
import { getShowcaseCards } from "@/lib/showcase";
import { CareerChips } from "../mercado/career-chips";
import { OffersList } from "./offers-list";

// ISR (ronda 63): la lista se arma una vez por hora, no por visita
export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Ofertas de muestra",
  description: "Las ofertas públicas más recientes, con link al aviso original.",
  // La muestra cambia todos los días: no se indexa, pero el robot tiene que poder leer esto
  robots: { index: false, follow: true },
};

export default async function OfertasPage() {
  const cards = await getShowcaseCards();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Ofertas de muestra</h1>
        <p className="max-w-2xl text-base text-zinc-700">
          Las ofertas más recientes del pool, de fuentes públicas. Cada una lleva el link al aviso
          original.
        </p>
      </header>
      <section aria-labelledby="carreras" className="flex flex-col gap-3">
        <h2 id="carreras" className="text-xl font-semibold">
          Por carrera
        </h2>
        <CareerChips base="/ofertas" label="Carreras" />
      </section>
      <section aria-labelledby="lista" className="flex flex-col gap-3">
        <h2 id="lista" className="text-xl font-semibold">
          Más recientes
        </h2>
        <OffersList cards={cards} contact={contactLink("Retirar un aviso")} />
      </section>
    </div>
  );
}
