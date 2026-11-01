import {
  BETA_OPENS_AT,
  BETA_PLAN,
  limitsText,
  listedPlans,
  paymentLink,
  planDef,
  priceLabel,
  priceReference,
  pricingEnabled,
  type PlanDef,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
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
  title: { absolute: "Precios" },
  description: `Un plan gratis y el plan de la beta: ${priceLabel(BETA)}, con un link de Mercado Pago.`,
  alternates: { canonical: "/precios" },
};

const CTA =
  "inline-flex min-h-11 items-center justify-center rounded-control px-4 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "¿La app postula por mí?",
    a: "No. Lee cada aviso contra tu perfil y te dice por qué sí y por qué no. La decisión y la postulación son tuyas.",
  },
  {
    q: "¿Cómo pago?",
    a: `Con un link de Mercado Pago, en pesos (${priceReference(BETA) ?? "sin referencia en dólares"}). También podés pagar por transferencia: escribinos y te pasamos los datos. La app no guarda datos de tarjetas.`,
  },
  {
    q: "¿Cuándo empieza mi acceso?",
    a: `Cuando se acredita tu pago, lo activamos a mano y tenés ${BETA.durationDays} días desde ese momento. Si pagás antes del ${OPENS}, los ${BETA.durationDays} días cuentan desde ese día.`,
  },
  {
    q: "¿Se renueva solo?",
    a: "No. Cada mes pagás de nuevo, con el mismo link. Tres días antes de que venza te avisamos dentro de la app, y ahí mismo ves hasta cuándo tenés acceso.",
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
          <PlanCard
            key={plan.key}
            plan={plan}
            lines={limitsText(plan.limits, enabled)}
            link={paymentLink(process.env, plan.key)}
          />
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

function PlanCard({ plan, lines, link }: { plan: PlanDef; lines: string[]; link: string | null }) {
  const free = plan.billing === "gratis";
  return (
    <li
      data-testid={`plan-${plan.key}`}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
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
            className={`${CTA} bg-brand text-brand-contrast hover:bg-brand-hover`}
          >
            Pedir acceso
          </Link>
        ) : link ? (
          // Link externo de Mercado Pago (validado en paymentLink): otra pestaña y sin referrer
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={`${CTA} border border-fg bg-surface text-fg hover:bg-surface-muted`}
          >
            Pagar con Mercado Pago
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : (
          <p className="text-sm text-fg-subtle">Pronto</p>
        )}
      </div>
    </li>
  );
}
