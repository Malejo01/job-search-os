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
  skillsFromCv,
}: {
  current: 1 | 2 | 3;
  /** El agente de perfil ya dejó las skills (ADR-034): el paso 2 se muestra como hecho con tu CV. */
  skillsFromCv?: boolean;
  /** `GuidedTour` de la pantalla (ronda 92): su botón va a la derecha de «Paso N de 3». */
  guide?: ReactNode;
}) {
  const now = STEPS.find((step) => step.n === current) ?? STEPS[0];
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <StepsList current={current} now={now} skillsFromCv={skillsFromCv === true} />
      {guide}
    </div>
  );
}

function StepsList({
  current,
  now,
  skillsFromCv,
}: {
  current: 1 | 2 | 3;
  now: (typeof STEPS)[number];
  skillsFromCv: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-bold text-fg-muted">
        Paso {now.n} de 3 · {now.name}
      </p>
      {/* C9-11: barra de avance en tres tramos (decorativa: el texto de arriba ya dice el paso) */}
      <div aria-hidden="true" className="flex w-40 gap-1">
        {STEPS.map((step) => (
          <span
            key={step.n}
            className={`h-1.5 flex-1 rounded-pill ${step.n <= current ? "bg-brand-text" : "bg-line-strong"}`}
          />
        ))}
      </div>
      <ol aria-label="Pasos" className="hidden list-none gap-4 p-0 text-sm sm:flex">
        {STEPS.map((step) => {
          const view = step.n < current ? "done" : step.n === current ? "current" : "next";
          return (
            <li
              key={step.n}
              aria-current={view === "current" ? "step" : undefined}
              className={
                view === "current"
                  ? "font-bold text-fg"
                  : view === "done"
                    ? "text-fg-subtle"
                    : "text-fg-subtle"
              }
            >
              {view === "done" ? <span aria-hidden="true">✓ </span> : null}
              {step.n}. {step.name}
              {skillsFromCv && step.n === 2 ? " (desde tu CV)" : null}
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
