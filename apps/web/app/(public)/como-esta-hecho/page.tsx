import type { Metadata } from "next";
import Link from "next/link";
import { getPoolShowcase } from "@/lib/showcase";
import { PoolNumbers } from "../mercado/pool-numbers";
import { FlowDiagram, FLOW_STEPS } from "./flow-diagram";

// ISR (ronda 63): la CPU de Vercel no alcanza para una consulta por visita
export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Cómo está hecho",
  description:
    "Cómo una oferta pasa de la fuente a la decisión: la IA evalúa, las reglas en código deciden y la persona elige. Stack, controles y código público.",
  alternates: { canonical: "/como-esta-hecho" },
};

const REPO_URL = "https://github.com/Malejo01/job-search-os";
const PRINCIPLES_URL = `${REPO_URL}/blob/main/docs/ARCHITECTURE.md`;

// Número fijo a propósito: no se cuenta en runtime. Conteo aproximado de casos de test (unitarios,
// integración y e2e) del repo al 20/10/2026: ~2.100.
const TESTS_LABEL = "más de 2.000 tests automatizados";
const TESTS_AS_OF = "20 de octubre de 2026";

const SAFEGUARDS = [
  [
    "Golden set",
    "Un conjunto de ofertas con la respuesta correcta acordada de antemano. Cada cambio de prompt se mide contra él, con métricas estrictas y laxas, antes de salir.",
  ],
  [
    "Salida validada",
    "El modelo responde con un formato fijo, validado con un esquema (Zod). Si no cumple, se reintenta o se descarta; no se acepta un campo que no cumpla el formato.",
  ],
  [
    "Las reglas viven en código",
    "Años, inglés, país y techos por título se aplican después del modelo, con tests. El modelo no puede “convencer” al sistema de aplicar, y el sistema nunca postula por vos: la persona decide.",
  ],
  [
    "Prompt injection",
    "Un aviso puede traer instrucciones escondidas para engañar a la IA. El texto del aviso es dato, no instrucciones: se detecta cuando un aviso intenta darle órdenes al evaluador, y ese aviso queda con techo de puntaje.",
  ],
  [
    "Tope de costo",
    "Hay límites de gasto diario por persona y en total, con corte en código y registro de cada llamada.",
  ],
  [
    "Los emails se leen sin riesgo",
    "Si un email reenviado no tiene la forma esperada, va a revisión manual. No hay extracción “a medias”. El HTML se muestra aislado, sin scripts ni navegación.",
  ],
];

const STACK = [
  ["Web", "Next.js (App Router), TypeScript estricto y Tailwind."],
  [
    "Datos",
    "Postgres con una regla que hace que cada persona vea solo lo suyo (Row Level Security, RLS) y Drizzle.",
  ],
  ["IA", "Vercel AI SDK. El modelo se elige por tabla de ruteo, con modelo de respaldo."],
  [
    "Calidad",
    "Vitest, Playwright, tests de integración con Postgres real y un CI con escáner de secretos.",
  ],
  ["Infra", "Vercel y Neon, con tareas programadas en GitHub Actions."],
];

const CTA_CLASS =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-5 text-base font-medium text-white";
const LINK_CLASS = "inline-flex min-h-11 items-center underline";

export default async function ComoEstaHechoPage() {
  const showcase = await getPoolShowcase();
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2 py-4">
        <h1 className="text-3xl font-semibold sm:text-4xl">Cómo está hecho</h1>
        <p className="max-w-2xl text-base text-zinc-700">
          Un sistema que lee ofertas de trabajo y las evalúa contra un perfil. El modelo de IA
          evalúa; las reglas en código deciden; la persona elige. Acá está cómo, con detalle.
        </p>
      </header>

      <section aria-labelledby="recorrido" className="flex flex-col gap-4">
        <h2 id="recorrido" className="text-xl font-semibold">
          El recorrido de una oferta
        </h2>
        <FlowDiagram />
        <ol className="flex max-w-3xl flex-col gap-3" aria-label="El recorrido, paso a paso">
          {FLOW_STEPS.map((step, i) => (
            <li
              key={step.title}
              className="flex min-w-0 gap-3 rounded-md border border-zinc-200 bg-white p-4"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white"
              >
                {i + 1}
              </span>
              <div className="min-w-0 text-sm leading-relaxed text-zinc-800 sm:text-base">
                <p className="font-semibold">{step.title}</p>
                <p>{step.text}</p>
                {step.note ? <p className="mt-1 italic">{step.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sin-inventar" className="flex flex-col gap-3">
        <h2 id="sin-inventar" className="text-xl font-semibold">
          Cómo se evita que la IA invente
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SAFEGUARDS.map(([title, text]) => (
            <li key={title} className="min-w-0 rounded-md border border-zinc-200 bg-white p-4">
              <p className="font-semibold">{title}</p>
              <p className="text-sm leading-relaxed text-zinc-700 sm:text-base">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="stack" className="flex flex-col gap-3">
        <h2 id="stack" className="text-xl font-semibold">
          Stack
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {STACK.map(([label, text]) => (
            <div key={label} className="min-w-0 rounded-md border border-zinc-200 bg-white p-4">
              <dt className="font-semibold">{label}</dt>
              <dd className="text-sm leading-relaxed text-zinc-700 sm:text-base">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="en-vivo" className="flex flex-col gap-3">
        <h2 id="en-vivo" className="text-xl font-semibold">
          En vivo
        </h2>
        <PoolNumbers showcase={showcase} />
        <p data-testid="tests-count" className="text-sm text-zinc-700">
          Hay {TESTS_LABEL} (conteo al {TESTS_AS_OF}).
        </p>
      </section>

      <section aria-labelledby="codigo" className="flex flex-col gap-3">
        <h2 id="codigo" className="text-xl font-semibold">
          El código
        </h2>
        <p className="text-sm text-zinc-700">El código es público: podés leerlo.</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-800">
          <a href={REPO_URL} target="_blank" rel="noopener" className={LINK_CLASS}>
            Repositorio en GitHub
            <span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
          <a href={PRINCIPLES_URL} target="_blank" rel="noopener" className={LINK_CLASS}>
            Principios de diseño
            <span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        </p>
      </section>

      <section className="flex flex-col items-start gap-3 py-2">
        <p className="text-base font-semibold">¿Buscás trabajo en tecnología?</p>
        <Link href="/acceso" className={CTA_CLASS}>
          Pedí acceso
        </Link>
      </section>
    </div>
  );
}
