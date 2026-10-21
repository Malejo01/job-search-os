import type { Metadata } from "next";
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
  "Vos decidís: si te postulás, a cuáles y cuándo.",
];

const PROMISES = [
  ["Nunca postula por vos", "Cada postulación la hacés vos, desde el sitio original."],
  ["No lee tu bandeja", "Solo mira lo que vos reenviás."],
  ["Tus datos son tuyos", "Podés pedir que se borren cuando quieras."],
];

const CTA_CLASS =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-5 text-base font-medium text-white";

export default async function HomePage() {
  const showcase = await getPoolShowcase();
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 py-4">
        <h1 className="max-w-2xl text-balance text-3xl font-semibold sm:text-4xl">
          Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no.
        </h1>
        <p className="max-w-2xl text-base text-zinc-700">
          Menos postulaciones, mejores. Vos ponés el criterio; la IA hace la lectura pesada.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/acceso" className={CTA_CLASS}>
            Pedir acceso
          </Link>
          <Link
            href="/demo"
            className="inline-flex min-h-11 items-center text-sm text-zinc-800 underline"
          >
            Ver una demo
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-sm text-zinc-800 underline"
          >
            Ya tengo cuenta
          </Link>
        </div>
      </section>

      <section aria-labelledby="como-funciona" className="flex flex-col gap-3">
        <h2 id="como-funciona" className="text-xl font-semibold">
          Cómo funciona
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((text, i) => (
            <li
              key={text}
              className="flex min-w-0 gap-3 rounded-md border border-zinc-200 bg-white p-4"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white"
              >
                {i + 1}
              </span>
              <span className="text-sm text-zinc-800">{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="promesas" className="flex flex-col gap-3">
        <h2 id="promesas" className="text-xl font-semibold">
          Lo que prometemos
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {PROMISES.map(([title, text]) => (
            <li key={title} className="min-w-0 rounded-md border border-zinc-200 bg-white p-4">
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-zinc-700">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="en-vivo" className="flex flex-col gap-3">
        <h2 id="en-vivo" className="text-xl font-semibold">
          El pool de ofertas, hoy
        </h2>
        <PoolNumbers showcase={showcase} />
        <p className="text-sm text-zinc-700">
          <Link href="/mercado" className="inline-flex min-h-11 items-center underline">
            Ver el mercado por carrera
          </Link>
          <span aria-hidden="true"> · </span>
          <Link href="/ofertas" className="inline-flex min-h-11 items-center underline">
            Ver ofertas de muestra
          </Link>
        </p>
      </section>

      <p className="text-sm text-zinc-700">
        <Link href="/como-esta-hecho" className="inline-flex min-h-11 items-center underline">
          ¿Sos reclutador o curioso? Mirá cómo está hecho
        </Link>
      </p>
    </div>
  );
}
