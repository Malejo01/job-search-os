import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { careerLabel } from "@/lib/career-market";
import { contactLink } from "@/lib/contact";
import { careerFromSlug, getShowcaseCards } from "@/lib/showcase";
import { CareerChips } from "../../mercado/career-chips";
import { OffersList } from "../offers-list";

// ISR (ronda 63): sin rutas prerenderizadas en el build; cada carrera se genera en la primera visita
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ carrera: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const role = careerFromSlug((await params).carrera);
  if (!role) return {};
  return {
    title: `Ofertas de ${careerLabel(role)}`,
    description: `Ofertas públicas recientes de ${careerLabel(role)}, con link al aviso original.`,
    robots: { index: false, follow: true },
  };
}

export default async function OfertasCarreraPage({ params }: Props) {
  const role = careerFromSlug((await params).carrera);
  if (!role) notFound();
  const label = careerLabel(role);
  const cards = await getShowcaseCards(role);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm">
          <Link
            href="/ofertas"
            className="inline-flex min-h-11 items-center text-zinc-700 underline"
          >
            Todas las ofertas
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">Ofertas de {label}</h1>
      </header>
      <OffersList cards={cards} contact={contactLink("Retirar un aviso")} />
      <section aria-labelledby="otras" className="flex flex-col gap-3">
        <h2 id="otras" className="text-xl font-semibold">
          Cambiar de carrera
        </h2>
        <CareerChips base="/ofertas" current={role} label="Cambiar de carrera" />
      </section>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-700">
        <Link href={`/mercado/${role}`} className="inline-flex min-h-11 items-center underline">
          Ver qué piden las ofertas de {label}
        </Link>
      </p>
    </div>
  );
}
