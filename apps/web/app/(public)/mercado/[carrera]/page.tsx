import {
  careerDatasetJsonLd,
  careerSeoDescription,
  jsonLdString,
  selectableRoleGroups,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CareerMarket } from "@/app/(app)/market/career-market";
import { careerLabel, getCareerMarket } from "@/lib/career-market";
import { getPublicCareerKeys } from "@/lib/career-visibility";
import { careerFromSlug } from "@/lib/showcase";
import { siteUrl } from "@/lib/site-url";
import { CareerChips } from "../career-chips";

// ISR (ronda 63): sin rutas prerenderizadas en el build (no necesita base); cada carrera se genera
// en la primera visita y queda cacheada una hora.
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ carrera: string }> };

const SIBLING_LINK =
  "inline-flex min-h-11 items-center text-fg-muted underline underline-offset-2 hover:text-fg";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const role = careerFromSlug((await params).carrera);
  if (!role) return {};
  const label = careerLabel(role);
  const title = `Mercado de ${label}: qué piden las ofertas`;
  // C-18: la descripción sale de los datos del pool (si el pool no responde, la genérica)
  const market = await getCareerMarket(role).catch(() => null);
  const description = market
    ? careerSeoDescription(market, label)
    : `Skills, inglés, seniority y sueldos que piden las ofertas públicas de ${label}.`;
  // Una carrera oculta (ADR-029) responde, pero no se anuncia: tampoco se indexa
  const listed = (await getPublicCareerKeys()).includes(role);
  return {
    title,
    description,
    alternates: { canonical: `/mercado/${role}` },
    ...(listed ? {} : { robots: { index: false, follow: true } }),
    // Un openGraph propio reemplaza entero al del layout, imagen incluida: se repite la de (public)
    openGraph: {
      title,
      description,
      url: `/mercado/${role}`,
      type: "website",
      locale: "es_AR",
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    },
  };
}

export default async function CareerMarketPage({ params }: Props) {
  const role = careerFromSlug((await params).carrera);
  if (!role) notFound();
  const label = careerLabel(role);
  const market = await getCareerMarket(role);
  const jsonLd = careerDatasetJsonLd({ market, label, url: `${siteUrl()}/mercado/${role}` });
  // Carreras del mismo grupo (enlaces internos), sin la actual ni las no publicadas
  const inGroup = (roles: readonly string[]) => roles.includes(role);
  const group = selectableRoleGroups().find((g) => inGroup(g.roles));
  const siblings = (group?.roles ?? []).filter((r) => r !== role);

  return (
    <div className="flex flex-col gap-6">
      {/* C-18: Dataset (agregados propios), nunca JobPosting. Escapado para no cerrar el script */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <header className="flex flex-col gap-2">
        <p className="text-sm">
          <Link
            href="/mercado"
            className="inline-flex min-h-11 items-center text-fg-muted underline underline-offset-2 hover:text-fg"
          >
            Todo el mercado
          </Link>
        </p>
        <h1 className="text-3xl font-semibold text-fg">Qué piden las ofertas de {label}</h1>
      </header>
      <CareerMarket market={market} label={label} />
      {group && siblings.length ? (
        <section aria-labelledby="parecidas" className="flex flex-col gap-2">
          <h2 id="parecidas" className="text-xl font-semibold text-fg">
            Carreras parecidas
          </h2>
          <p className="text-sm text-fg-muted">Del mismo grupo: {group.label}.</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {siblings.map((r) => (
              <li key={r}>
                <Link href={`/mercado/${r}`} className={SIBLING_LINK}>
                  {careerLabel(r)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="otras" className="flex flex-col gap-3">
        <h2 id="otras" className="text-xl font-semibold text-fg">
          Cambiar de carrera
        </h2>
        <CareerChips base="/mercado" current={role} label="Cambiar de carrera" />
      </section>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        <Link
          href={`/ofertas/${role}`}
          className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
        >
          Ver ofertas de muestra de {label}
        </Link>
        <span aria-hidden="true"> · </span>
        <Link
          href="/acceso"
          className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
        >
          Pedir acceso
        </Link>
      </p>
    </div>
  );
}
