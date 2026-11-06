import {
  BETA_OPENS_AT,
  BETA_PLAN,
  limitsText,
  listedPlans,
  planDef,
  priceLabel,
  priceReference,
  pricingEnabled,
  type PlanDef,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
import { publicOpenGraph } from "@/lib/public-og";
import Link from "next/link";
import { notFound } from "next/navigation";

// El flag y los links salen de variables: con ISR se releen al revalidar, sin pasar por la base
export const revalidate = 3600;

const BETA = planDef(BETA_PLAN);
const OPENS = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  timeZone: "America/Argentina/Buenos_Aires",
}).format(BETA_OPENS_AT);

export const metadata: Metadata = {
  title: "Precios",
  description: `Un plan gratis y el plan de la beta: ${priceLabel(BETA)}. El link de pago llega con la invitación.`,
  alternates: { canonical: "/precios" },
  openGraph: publicOpenGraph({ path: "/precios" }),
};

const CTA =
  "inline-flex min-h-12 items-center justify-center rounded-pill px-5 text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "¿La app postula por mí?",
    a: "No. Lee cada aviso contra tu perfil y te dice por qué sí y por qué no. La decisión y la postulación son tuyas.",
  },
  {
    q: "¿Cómo pago?",
    a: `Cuando te invitamos, te mandamos el link de Mercado Pago junto con la invitación. Se paga en pesos (${priceReference(BETA) ?? "sin referencia en dólares"}). También podés pagar por transferencia: escribinos y te pasamos los datos. La app no guarda datos de tarjetas.`,
  },
  {
    q: "¿Cuándo empieza mi acceso?",
    a: `Cuando se acredita tu pago, lo activamos a mano y tenés ${BETA.durationDays} días desde ese momento. Si pagás antes del ${OPENS}, los ${BETA.durationDays} días cuentan desde ese día.`,
  },
  {
    q: "¿Se renueva solo?",
    a: "No. Cada mes pagás de nuevo, con el mismo link de la invitación. Tres días antes de que venza te avisamos, y en Ajustes ves hasta cuándo tenés acceso.",
  },
  {
    q: "¿Qué pasa cuando vence?",
    a: "Pasás al plan gratis: tus datos, tus ofertas y tus postulaciones siguen guardados, con menos ofertas evaluadas por día. Si volvés a pagar, retomás el plan completo.",
  },
  {
    q: "¿Dan factura?",
    a: "Durante la beta no emitimos factura.",
  },
  {
    q: "¿Qué es una carrera «en pulido»?",
    a: "Una carrera que todavía tiene pocas ofertas o en la que estamos ajustando cómo se evalúa. Se puede usar igual, y tu 👍 o 👎 en cada oferta la mejora.",
  },
];

/**
 * Precios (C-12 y C3-1). Pública y solo con `PRICING_ENABLED`: apagado, 404. Los planes, los topes y los
 * precios salen de `PLANS` (pipeline): acá no hay ninguna cifra propia. Solo se ofrecen los planes
 * `listed` (gratis y Beta). Un plan sin link de pago dice «Pronto», sin botón.
 */
export default function PreciosPage() {
  if (!pricingEnabled(process.env)) notFound();
  const enabled = { cv: process.env.CV_IMPORT_ENABLED === "1", assistant: false };
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Precios</h1>
        <p className="max-w-2xl text-base text-fg-muted">
          La beta es cerrada y abre el {OPENS}. Un solo plan pago, mes a mes: evalúa más ofertas por
          día y te deja seguir más carreras a la vez. Si no renovás, no perdés nada de lo tuyo.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2" data-testid="precios-planes">
        {listedPlans().map((plan) => (
          <PlanCard key={plan.key} plan={plan} lines={limitsText(plan.limits, enabled)} />
        ))}
      </ul>

      <section aria-labelledby="preguntas" className="flex flex-col gap-3">
        <h2 id="preguntas" className="text-xl font-semibold">
          Preguntas frecuentes
        </h2>
        <dl className="flex flex-col gap-4">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt className="font-medium text-fg">{q}</dt>
              <dd className="mt-1 text-sm text-fg-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-sm">
        La beta es por invitación.{" "}
        <Link href="/acceso" className="font-medium underline underline-offset-2 hover:text-fg">
          Pedí acceso
        </Link>{" "}
        y te avisamos cuando haya lugar.
      </p>
    </div>
  );
}

function PlanCard({ plan, lines }: { plan: PlanDef; lines: string[] }) {
  const free = plan.billing === "gratis";
  return (
    <li
      data-testid={`plan-${plan.key}`}
      className="flex flex-col gap-3 rounded-card bg-surface p-4"
    >
      <div>
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        <p className="text-sm text-fg-muted">{plan.summary}</p>
      </div>
      <div>
        <p className="text-xl font-semibold" data-testid={`precio-${plan.key}`}>
          {priceLabel(plan)}
        </p>
        {priceReference(plan) ? (
          <p className="text-xs text-fg-subtle" data-testid={`referencia-${plan.key}`}>
            {priceReference(plan)}. Se cobra en pesos.
          </p>
        ) : null}
      </div>
      {plan.durationDays ? (
        <p className="text-xs text-fg-subtle">
          Cada pago dura {plan.durationDays} días y no se renueva solo.
        </p>
      ) : null}
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="mt-auto">
        {free ? (
          <Link
            href="/acceso"
            className={`${CTA} pressable edge-6 border-edge-brand bg-brand text-brand-contrast hover:bg-brand-hover`}
          >
            Pedir acceso
          </Link>
        ) : (
          // C7-12: sin botón ni link de pago acá; el link va solo en el mensaje de invitación
          <p className="rounded-control bg-surface-muted px-3 py-2 text-sm font-semibold text-fg-muted">
            Te pasamos el link de pago cuando te invitemos.
          </p>
        )}
      </div>
    </li>
  );
}
