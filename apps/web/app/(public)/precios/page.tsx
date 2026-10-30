import {
  GUARANTEE_DAYS,
  limitsText,
  paymentLink,
  PLANS,
  priceLabel,
  pricingEnabled,
  type PlanDef,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

// El flag y los links salen de variables: con ISR se releen al revalidar, sin pasar por la base
export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: "Precios" },
  description:
    "Un plan gratis para probar y planes pagos con más ofertas evaluadas por día. Garantía de 14 días.",
  alternates: { canonical: "/precios" },
};

const CTA =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "¿La app postula por mí?",
    a: "No. Lee cada aviso contra tu perfil y te dice por qué sí y por qué no. La decisión y la postulación son tuyas.",
  },
  {
    q: "¿Cómo pago?",
    a: "Con Mercado Pago, desde un link de pago. La app no guarda datos de tarjetas.",
  },
  {
    q: "¿Qué pasa si no me sirve?",
    a: `Tenés ${GUARANTEE_DAYS} días de garantía desde que pagás: si no te sirve, escribinos y te devolvemos lo que pagaste.`,
  },
  {
    q: "¿Qué es una carrera «en pulido»?",
    a: "Una carrera que todavía tiene pocas ofertas o en la que estamos ajustando cómo se evalúa. Se puede usar igual, y tu 👍 o 👎 en cada oferta la mejora.",
  },
  {
    q: "¿Qué es el plan Fundador?",
    a: "Un precio de lanzamiento para las primeras personas de cada carrera. Los cupos son pocos por carrera.",
  },
];

/**
 * Precios (C-12). Pública y solo con `PRICING_ENABLED`: apagado, 404. Los planes, los topes y los
 * precios salen de `PLANS` (pipeline): acá no hay ninguna cifra propia. Un precio sin decidir dice
 * «Precio a confirmar» y un plan sin link de pago dice «Pronto», sin botón.
 */
export default function PreciosPage() {
  if (!pricingEnabled(process.env)) notFound();
  const enabled = { cv: process.env.CV_IMPORT_ENABLED === "1", assistant: false };
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Precios</h1>
        <p className="max-w-2xl text-base text-zinc-700">
          Empezá gratis con tu carrera principal. Si te sirve, un plan pago evalúa más ofertas por
          día y suma carreras.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="precios-planes">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.key}
            plan={plan}
            lines={limitsText(plan.limits, enabled)}
            link={paymentLink(process.env, plan.key)}
          />
        ))}
      </ul>

      <section
        aria-labelledby="garantia"
        className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"
      >
        <h2 id="garantia" className="text-lg font-semibold text-emerald-950">
          Garantía de {GUARANTEE_DAYS} días
        </h2>
        <p className="mt-1 text-sm text-emerald-950">
          Si en los primeros {GUARANTEE_DAYS} días ves que no te sirve, escribinos y te devolvemos
          lo que pagaste.
        </p>
      </section>

      <section aria-labelledby="preguntas" className="flex flex-col gap-3">
        <h2 id="preguntas" className="text-xl font-semibold">
          Preguntas frecuentes
        </h2>
        <dl className="flex flex-col gap-4">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt className="font-medium text-zinc-900">{q}</dt>
              <dd className="mt-1 text-sm text-zinc-700">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-sm">
        La beta es por invitación.{" "}
        <Link href="/acceso" className="font-medium underline underline-offset-2">
          Pedí acceso
        </Link>{" "}
        y te avisamos cuando haya lugar.
      </p>
    </div>
  );
}

function PlanCard({ plan, lines, link }: { plan: PlanDef; lines: string[]; link: string | null }) {
  const free = plan.billing === "gratis";
  return (
    <li
      data-testid={`plan-${plan.key}`}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4"
    >
      <div>
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        <p className="text-sm text-zinc-700">{plan.summary}</p>
      </div>
      <p className="text-xl font-semibold" data-testid={`precio-${plan.key}`}>
        {priceLabel(plan)}
      </p>
      {plan.durationDays ? (
        <p className="text-xs text-zinc-600">Dura {plan.durationDays} días.</p>
      ) : null}
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-zinc-800">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="mt-auto">
        {free ? (
          <Link href="/acceso" className={`${CTA} bg-zinc-900 text-white`}>
            Pedir acceso
          </Link>
        ) : link ? (
          // Link externo de Mercado Pago (validado en paymentLink): otra pestaña y sin referrer
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={`${CTA} border border-zinc-900 text-zinc-900`}
          >
            Pagar con Mercado Pago
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : (
          <p className="text-sm text-zinc-600">Pronto</p>
        )}
      </div>
    </li>
  );
}
