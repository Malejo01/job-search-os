import type { Metadata } from "next";
import { BRAND } from "@job-search-os/pipeline";
import Link from "next/link";
import { getPoolShowcase } from "@/lib/showcase";
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

const CTA_CLASS =
  "inline-flex min-h-12 items-center justify-center rounded-control bg-brand px-6 text-base font-bold text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const HERO_LINK =
  "inline-flex min-h-11 items-center text-sm font-semibold text-on-ink underline underline-offset-2 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

export default async function HomePage() {
  const showcase = await getPoolShowcase();
  return (
    <div className="flex flex-col gap-10">
      {/* Hero tinta (C7-10, manual Main y P2): la bajada en naranja, la propuesta y el pedido de acceso */}
      <section className="flex flex-col gap-4 rounded-card border border-ink-line bg-ink px-5 py-8 text-on-ink sm:px-10 sm:py-12">
        <p className="font-display text-lg font-extrabold tracking-tight text-brand sm:text-xl">
          {BRAND.tagline}
        </p>
        <h1 className="max-w-3xl text-balance text-3xl leading-tight font-extrabold tracking-tight sm:text-5xl">
          Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no.
        </h1>
        <p className="max-w-2xl text-base text-on-ink-muted">
          Menos postulaciones, mejor elegidas. Vos ponés el criterio; la IA hace la lectura pesada y
          te explica cada puntaje.
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
      </section>

      <section aria-labelledby="como-funciona" className="flex flex-col gap-3">
        <h2 id="como-funciona" className="font-display text-xl font-bold text-fg">
          Cómo funciona
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((text, i) => (
            <li
              key={text}
              className="flex min-w-0 gap-3 rounded-card border border-line bg-surface p-4"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand text-sm font-bold text-brand-contrast"
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
            <li key={title} className="min-w-0 rounded-card border border-line bg-surface p-4">
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
