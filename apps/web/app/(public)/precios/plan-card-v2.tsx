import {
  RECOMMENDED_LABEL,
  planBenefits,
  planExclusions,
  pricePerDayLabel,
  pricePerDayNote,
  priceLabel,
  priceReference,
  type PlanDef,
} from "@job-search-os/pipeline";
import Link from "next/link";

const CTA =
  "inline-flex min-h-12 items-center justify-center rounded-pill px-5 text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * Tarjeta de plan de la página v2 (R15-1, detrás de `PRICING_V2`). Mismo precio, mismo link y mismos
 * `data-testid` que la tarjeta de siempre; suma el precio por día, los beneficios como resultados, lo que
 * no incluye (en gris, `text-fg-subtle` pasa AA sobre todos los fondos) y, en el plan sugerido, la etiqueta
 * «Recomendado». No hay contadores, cupos ni precios tachados. Server Component, sin estado.
 */
export function PlanCardV2({
  plan,
  reference,
  recommended,
  enabled,
}: {
  plan: PlanDef;
  /** El plan más completo: contra él se cuenta lo que este plan no incluye. */
  reference: PlanDef;
  recommended: boolean;
  enabled: { cv: boolean; assistant: boolean };
}) {
  const free = plan.billing === "gratis";
  const perDay = pricePerDayLabel(plan);
  const perDayNote = pricePerDayNote(plan);
  const benefits = planBenefits(plan.limits, enabled);
  const missing = planExclusions(plan, reference, enabled);
  return (
    <li
      data-testid={`plan-${plan.key}`}
      data-recomendado={recommended ? "1" : "0"}
      className={`flex flex-col gap-3 rounded-card border-2 bg-surface p-4 ${
        recommended ? "border-brand" : "border-transparent"
      }`}
    >
      {recommended ? (
        <p
          data-testid="plan-recomendado"
          className="w-fit rounded-pill bg-brand px-3 py-1 text-xs font-extrabold text-brand-contrast"
        >
          {RECOMMENDED_LABEL}
        </p>
      ) : null}
      <div>
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        <p className="text-sm text-fg-muted">{plan.summary}</p>
      </div>
      <div>
        <p className="text-xl font-semibold" data-testid={`precio-${plan.key}`}>
          {priceLabel(plan)}
        </p>
        {perDay ? (
          <p className="text-sm font-semibold text-fg" data-testid={`precio-dia-${plan.key}`}>
            {perDay}
          </p>
        ) : null}
        {perDayNote ? (
          <p className="text-xs text-fg-subtle" data-testid={`precio-dia-cuenta-${plan.key}`}>
            {perDayNote}
          </p>
        ) : null}
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
      <div>
        <h3 className="text-sm font-bold text-fg">Qué te da</h3>
        <ul
          data-testid={`beneficios-${plan.key}`}
          className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-fg"
        >
          {benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </div>
      {missing.length > 0 ? (
        <div>
          <h3 className="text-sm font-bold text-fg-subtle">No incluye</h3>
          <ul
            data-testid={`no-incluye-${plan.key}`}
            className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-fg-subtle"
          >
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-auto">
        {free ? (
          <Link
            href="/acceso"
            className={`${CTA} pressable edge-6 border-edge-brand bg-brand text-brand-contrast hover:bg-brand-hover`}
          >
            Pedir acceso
          </Link>
        ) : (
          // Igual que la tarjeta de siempre (C7-12): el link de pago va solo en el mensaje de invitación
          <p className="rounded-control bg-surface-muted px-3 py-2 text-sm font-semibold text-fg-muted">
            Te pasamos el link de pago cuando te invitemos.
          </p>
        )}
      </div>
    </li>
  );
}
