import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CareerMarket } from "@/app/(app)/market/career-market";
import { careerLabel, getCareerMarket } from "@/lib/career-market";
import { careerFromSlug } from "@/lib/showcase";
import { CareerChips } from "../career-chips";

// ISR (ronda 63): sin rutas prerenderizadas en el build (no necesita base); cada carrera se genera
// en la primera visita y queda cacheada una hora.
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ carrera: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const role = careerFromSlug((await params).carrera);
  if (!role) return {};
  const label = careerLabel(role);
  return {
    title: `Mercado de ${label}: qué piden las ofertas`,
    description: `Skills, inglés, seniority y sueldos que piden las ofertas públicas de ${label}.`,
  };
}

export default async function CareerMarketPage({ params }: Props) {
  const role = careerFromSlug((await params).carrera);
  if (!role) notFound();
  const label = careerLabel(role);
  const market = await getCareerMarket(role);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm">
          <Link
            href="/mercado"
            className="inline-flex min-h-11 items-center text-zinc-700 underline"
          >
            Todo el mercado
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">Qué piden las ofertas de {label}</h1>
      </header>
      <CareerMarket market={market} label={label} />
      <section aria-labelledby="otras" className="flex flex-col gap-3">
        <h2 id="otras" className="text-xl font-semibold">
          Cambiar de carrera
        </h2>
        <CareerChips base="/mercado" current={role} label="Cambiar de carrera" />
      </section>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-700">
        <Link href={`/ofertas/${role}`} className="inline-flex min-h-11 items-center underline">
          Ver ofertas de muestra de {label}
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href="/acceso" className="inline-flex min-h-11 items-center underline">
          Pedir acceso
        </Link>
      </p>
    </div>
  );
}
