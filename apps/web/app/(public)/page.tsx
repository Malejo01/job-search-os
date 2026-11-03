import type { Metadata } from "next";
import { BRAND } from "@job-search-os/pipeline";
import Link from "next/link";
import { getPoolShowcase } from "@/lib/showcase";
import { buttonClasses, Chip, Seal } from "@/components/ui";
import { PoolNumbers } from "./mercado/pool-numbers";

// ISR (ronda 63): la CPU de Vercel no alcanza para una consulta por visita. Nada dinámico acá.
export const revalidate = 3600;
// Título y descripción vienen del layout (propuesta de valor); acá solo la URL canónica
export const metadata: Metadata = { alternates: { canonical: "/" } };

const STEPS = [
  "Cargás tu perfil: qué sabés, qué buscás y qué no.",
  "La IA lee cada aviso contra tu perfil y te dice por qué sí y por qué no.",
  "Vos decidís: si te postulás, a cuáles y cuándo. Nunca postulamos por vos.",
];

// Voz del manual (M7): en primera persona, frases cortas y la decisión siempre del lado de la persona
const PROMISES = [
  ["Nunca postulamos por vos", "Cada postulación la hacés vos, en el sitio del aviso."],
  ["No leemos tu bandeja", "Solo vemos lo que vos reenviás."],
  ["Tus datos son tuyos", "Podés pedir que los borremos cuando quieras."],
];

// C9-16: el botón principal con la forma P1 (lima, borde inferior y hundimiento); sobre índigo el
// foco va en lima
const CTA_CLASS = buttonClasses({
  className: "focus-visible:outline-brand",
});
const HERO_LINK =
  "inline-flex min-h-11 items-center text-sm font-bold text-on-ink underline underline-offset-2 hover:text-on-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

export default async function HomePage() {
  const showcase = await getPoolShowcase();
  return (
    <div className="flex flex-col gap-10">
      {/* Hero índigo (C9-16): cabecera curva con la propuesta, el pedido de acceso y, como lo único
          memorable de la pantalla, una oferta de ejemplo con su sello */}
      <section className="-mx-4 -mt-6 flex flex-col gap-8 rounded-b-[2.5rem] bg-ink px-5 pt-8 pb-10 text-on-ink sm:mx-0 sm:mt-0 sm:rounded-container sm:px-10 sm:py-12 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <p className="font-display text-lg font-extrabold tracking-tight text-on-ink-muted sm:text-xl">
            {BRAND.tagline}
          </p>
          <h1 className="max-w-3xl text-balance text-3xl leading-tight font-extrabold tracking-tight sm:text-5xl">
            Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no.
          </h1>
          <p className="max-w-2xl text-base text-on-ink-muted">
            Menos postulaciones, mejor elegidas. Vos ponés el criterio; la IA hace la lectura pesada
            y te explica cada puntaje.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link href="/acceso" className={CTA_CLASS}>
              Pedir acceso
            </Link>
            <Link href="/demo" className={HERO_LINK}>
              Ver una demo
            </Link>
            <Link href="/login" className={HERO_LINK}>
              Ya tengo cuenta
            </Link>
          </div>
        </div>
        <SampleOffer />
      </section>

      <section aria-labelledby="como-funciona" className="flex flex-col gap-3">
        <h2 id="como-funciona" className="font-display text-xl font-bold text-fg">
          Cómo funciona
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((text, i) => (
            <li key={text} className="flex min-w-0 gap-3 rounded-card bg-surface p-5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-ink font-display text-sm font-extrabold text-on-ink"
              >
                {i + 1}
              </span>
              <span className="text-sm text-fg">{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="promesas" className="flex flex-col gap-3">
        <h2 id="promesas" className="font-display text-xl font-bold text-fg">
          Lo que prometemos
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {PROMISES.map(([title, text]) => (
            <li key={title} className="min-w-0 rounded-card bg-surface p-5">
              <p className="font-bold text-fg">{title}</p>
              <p className="text-sm text-fg-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="en-vivo" className="flex flex-col gap-3">
        <h2 id="en-vivo" className="font-display text-xl font-bold text-fg">
          El pool de ofertas, hoy
        </h2>
        <PoolNumbers showcase={showcase} />
        <p className="text-sm text-fg-muted">
          <Link
            href="/mercado"
            className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
          >
            Ver el mercado por carrera
          </Link>
          <span aria-hidden="true"> · </span>
          <Link
            href="/ofertas"
            className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
          >
            Ver ofertas de muestra
          </Link>
        </p>
      </section>

      <p className="text-sm text-fg-muted">
        <Link
          href="/como-esta-hecho"
          className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
        >
          ¿Sos reclutador o curioso? Mirá cómo está hecho
        </Link>
      </p>
    </div>
  );
}

/**
 * Una oferta de ejemplo con su sello (C9-16), con datos inventados: muestra en un vistazo lo que
 * hace la app. Es una imagen para el lector de pantalla (una sola descripción, no una tarjeta que
 * se pueda tocar).
 */
function SampleOffer() {
  return (
    <figure
      role="img"
      aria-label="Ejemplo: una oferta de analista contable con el sello «Muy afín», 9,2 de 10"
      className="edge-6 flex w-full max-w-sm shrink-0 gap-3 self-center rounded-card border-edge bg-surface p-5 text-fg lg:self-auto"
    >
      <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-display text-lg leading-snug font-bold">Analista contable</p>
        <p className="text-sm text-fg-muted">Estudio Ruiz y Asociados, en Salta</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="have">Liquidación de sueldos</Chip>
          <Chip tone="missing">Tango Gestión</Chip>
        </div>
        <p className="text-sm font-bold">4 a tu favor, 1 te falta</p>
      </div>
      <div aria-hidden="true">
        <Seal score={9.2} as="text" size="detail" />
      </div>
    </figure>
  );
}
