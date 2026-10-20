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
export function OnboardingSteps({ current }: { current: 1 | 2 | 3 }) {
  const now = STEPS.find((step) => step.n === current) ?? STEPS[0];
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium text-zinc-600">
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
                  ? "font-semibold text-zinc-900"
                  : view === "done"
                    ? "text-zinc-600"
                    : "text-zinc-500"
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
