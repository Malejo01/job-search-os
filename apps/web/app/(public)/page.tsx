import type { Metadata } from "next";
import { publicOpenGraph } from "@/lib/public-og";
import { BRAND } from "@job-search-os/pipeline";
import Link from "next/link";
import { getPoolShowcase } from "@/lib/showcase";
import { buttonClasses, cardClasses, CheckMark } from "@/components/ui";
import { OfferCard } from "@/components/offer-card";
import { PoolNumbers } from "./mercado/pool-numbers";

// ISR (ronda 63): la CPU de Vercel no alcanza para una consulta por visita. Nada dinámico acá.
export const revalidate = 3600;
// Título y descripción vienen del layout (propuesta de valor); acá solo la URL canónica
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: publicOpenGraph({ path: "/" }),
};

/** Los tres pasos (portada-pc.png): título y, en la computadora, una línea de cómo. */
const STEPS = [
  ["Contanos tu carrera", "Tu CV y tus áreas. Cinco minutos, una sola vez."],
  ["Recibí ofertas con sello", "Cada aviso llega con su afinidad y el porqué."],
  ["Acercate con un paso", "Lo que te falta, dicho como algo que podés hacer."],
] as const;

// Voz del manual (M7): en primera persona, frases cortas y la decisión siempre del lado de la persona
const PROMISES = [
  ["Nunca postulamos por vos", "Cada postulación la hacés vos, en el sitio del aviso."],
  ["No leemos tu bandeja", "Solo vemos lo que vos reenviás."],
  ["Tus datos son tuyos", "Podés pedir que los borremos cuando quieras."],
];

const LINK =
  "inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus";

/**
 * Portada (C10-4): copia de las pantallas aprobadas el 4/11 (`referencias/portada-pc.png` y
 * `portada-cel.png`, medidas de `S1-publicas.html`). Sobre el lavanda: el aviso de la beta, el
 * titular, la bajada, los dos botones y, a la derecha, un panel blanco levemente girado con dos
 * ofertas de ejemplo; abajo, los tres pasos. Lo que ya estaba aprobado (las promesas, el pool en
 * vivo y «cómo está hecho») sigue más abajo, fuera de la primera pantalla.
 *
 * `data-ancho="completo"`: el layout público le saca su ancho máximo y su margen (la portada usa
 * el de la referencia, 72 px a los costados en la computadora).
 */
export default async function HomePage() {
  const showcase = await getPoolShowcase();
  return (
    <div
      data-ancho="completo"
      className="mx-auto flex w-full max-w-[1280px] flex-col px-5 pt-[26px] pb-12 sm:px-[72px] sm:pt-16"
    >
      <div className="flex flex-col gap-[22px] lg:flex-row lg:items-center lg:gap-14">
        <div className="flex min-w-0 flex-col lg:basis-[52%]">
          <p className="self-start rounded-pill bg-surface px-3 py-1.5 text-xs font-extrabold text-brand-text sm:px-3.5 sm:py-[7px] sm:text-[13px]">
            <span className="sm:hidden">Beta cerrada · abre el 26/11</span>
            <span className="hidden sm:inline">Beta cerrada · abre el 26 de noviembre</span>
          </p>
          <h1 className="mt-3.5 max-w-[540px] text-[36px] leading-[1.04] font-extrabold tracking-[-1.2px] text-fg sm:mt-5 sm:text-[62px] sm:leading-[1.02] sm:tracking-[-2px]">
            Las ofertas que te quedan bien, con el porqué.
          </h1>
          <p className="mt-3 max-w-[520px] text-base leading-[1.5] font-medium text-fg-muted sm:mt-5 sm:text-[19px]">
            <span className="sm:hidden">
              Leemos cada aviso contra tu perfil y te decimos qué tan afín es y qué paso te acerca.
            </span>
            <span className="hidden sm:inline">
              Leemos cada aviso contra tu perfil y te decimos qué tan afín es, qué tenés a favor y
              qué paso te acerca. Para 6 carreras, en Salta y remoto.
            </span>
          </p>
          <div className="mt-5 flex gap-3.5 sm:mt-8">
            <Link
              href="/acceso"
              className={buttonClasses({ size: "lg", className: "w-full sm:w-auto" })}
            >
              Anotarme a la beta
            </Link>
            <span className="hidden sm:block">
              <Link href="/demo" className={buttonClasses({ size: "lg", variant: "secondary" })}>
                Ver una oferta de ejemplo
              </Link>
            </span>
          </div>
        </div>
        <SampleOffers />
      </div>

      <section aria-labelledby="como-funciona" className="mt-[18px] sm:mt-[52px]">
        <h2 id="como-funciona" className="sr-only">
          Cómo funciona
        </h2>
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0 sm:grid sm:grid-cols-3 sm:gap-[18px]">
          {STEPS.map(([title, text], i) => (
            <li
              key={title}
              className="flex min-w-0 items-center gap-2.5 sm:items-start sm:gap-3.5 sm:rounded-card sm:border-x-2 sm:border-t-2 sm:border-b-4 sm:border-line sm:bg-surface sm:p-5"
            >
              <CheckMark done>{i + 1}</CheckMark>
              <div className="min-w-0">
                <p className="text-sm font-bold text-fg sm:font-display sm:text-[17px]">{title}</p>
                <p className="mt-1 hidden text-sm leading-[1.45] font-medium text-fg-subtle sm:block">
                  {text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Lo aprobado antes de C10, debajo de la primera pantalla */}
      <section aria-labelledby="promesas" className="mt-48 flex flex-col gap-3 sm:mt-44">
        <p className="font-display text-sm font-extrabold text-brand-text">{BRAND.tagline}</p>
        <h2 id="promesas" className="font-display text-xl font-bold text-fg">
          Lo que prometemos
        </h2>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
          {PROMISES.map(([title, text]) => (
            <li key={title} className={cardClasses({ level: "list", padding: "md" })}>
              <p className="font-bold text-fg">{title}</p>
              <p className="text-sm text-fg-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="en-vivo" className="mt-10 flex flex-col gap-3">
        <h2 id="en-vivo" className="font-display text-xl font-bold text-fg">
          El pool de ofertas, hoy
        </h2>
        <PoolNumbers showcase={showcase} />
        <p className="text-sm text-fg-muted">
          <Link href="/mercado" className={LINK}>
            Ver el mercado por carrera
          </Link>
          <span aria-hidden="true"> · </span>
          <Link href="/ofertas" className={LINK}>
            Ver ofertas de muestra
          </Link>
        </p>
      </section>

      <p className="mt-6 text-sm text-fg-muted">
        <Link href="/como-esta-hecho" className={LINK}>
          ¿Sos reclutador o curioso? Mirá cómo está hecho
        </Link>
      </p>
    </div>
  );
}

/**
 * Dos ofertas de ejemplo (datos inventados) en un panel blanco girado 1,5° en la computadora; en el
 * celular, una sola, derecha, con los chips cortos. Para el lector de pantalla es una imagen con una
 * descripción: no son tarjetas que se toquen.
 */
function SampleOffers() {
  return (
    <figure
      role="img"
      aria-label="Ejemplo: «Analista contable semi senior» con el sello «Muy afín», 8,5 de 10, y «Liquidador de sueldos» con «Bastante afín», 7,4"
      className="-mx-1 flex flex-col gap-3.5 rounded-container bg-surface p-3.5 sm:mx-0 sm:p-[22px] lg:basis-[48%] lg:rotate-[1.5deg]"
    >
      <div aria-hidden="true" className="sm:hidden">
        <OfferCard
          as="div"
          featured
          title="Analista contable semi senior"
          place="Estudio Ruiz y Asociados, en Salta"
          chips={[
            { tone: "have", label: "Sueldos" },
            { tone: "have", label: "IVA" },
            { tone: "missing", label: "Tango" },
          ]}
          score={8.5}
        />
      </div>
      <div aria-hidden="true" className="hidden flex-col gap-3.5 sm:flex">
        <OfferCard
          as="div"
          featured
          title="Analista contable semi senior"
          place="Estudio Ruiz y Asociados, en Salta"
          chips={[
            { tone: "have", label: "Liquidación de sueldos" },
            { tone: "have", label: "IVA y Ganancias" },
            { tone: "missing", label: "Tango" },
          ]}
          count="4 a tu favor, 1 te falta"
          meta="Presencial · hace 2 días"
          score={8.5}
        />
        <OfferCard
          as="div"
          title="Liquidador de sueldos"
          place="Grupo Norte, remoto en Argentina"
          chips={[
            { tone: "have", label: "Convenios colectivos" },
            { tone: "missing", label: "inglés intermedio" },
          ]}
          score={7.4}
        />
      </div>
    </figure>
  );
}
