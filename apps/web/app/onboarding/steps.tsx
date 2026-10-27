import type { ReactNode } from "react";

const STEPS = [
  { n: 1, name: "Tu perfil" },
  { n: 2, name: "Tus skills" },
  { n: 3, name: "Tus primeras ofertas" },
] as const;

/**
 * «Paso N de 3» arriba del h1 del onboarding. En celular, una línea de texto; desde 640 px, los
 * tres nombres en fila. Los pasos anteriores no son links: volver al 1 con el perfil completo
 * redirige a /jobs.
 */
export function OnboardingSteps({
  current,
  guide,
}: {
  current: 1 | 2 | 3;
  /** `GuidedTour` de la pantalla (ronda 92): su botón va a la derecha de «Paso N de 3». */
  guide?: ReactNode;
}) {
  const now = STEPS.find((step) => step.n === current) ?? STEPS[0];
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <StepsList current={current} now={now} />
      {guide}
    </div>
  );
}

function StepsList({ current, now }: { current: 1 | 2 | 3; now: (typeof STEPS)[number] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium text-fg-subtle">
        Paso {now.n} de 3 · {now.name}
      </p>
      <ol aria-label="Pasos" className="hidden list-none gap-4 p-0 text-sm sm:flex">
        {STEPS.map((step) => {
          const view = step.n < current ? "done" : step.n === current ? "current" : "next";
          return (
            <li
              key={step.n}
              aria-current={view === "current" ? "step" : undefined}
              className={
                view === "current"
                  ? "font-semibold text-fg"
                  : view === "done"
                    ? "text-fg-subtle"
                    : "text-fg-subtle"
              }
            >
              {view === "done" ? <span aria-hidden="true">✓ </span> : null}
              {step.n}. {step.name}
              <span className="sr-only">
                {view === "done" ? " (hecho)" : view === "current" ? " (actual)" : " (pendiente)"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
