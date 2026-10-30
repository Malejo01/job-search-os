import { FALTA_KIND_LABEL, type FaltaKind, type FitPoints } from "@job-search-os/pipeline";

/** Cada punto lleva ícono y texto, no solo color: el significado no depende de verlo. */
const FALTA_MARK: Record<FaltaKind, { icon: string; classes: string }> = {
  frena: { icon: "✕", classes: "text-danger" },
  falta: { icon: "–", classes: "text-fg" },
  ojo: { icon: "!", classes: "text-warning" },
  sin_dato: { icon: "?", classes: "text-fg-muted" },
};

/**
 * «A tu favor» y «Te falta o te frena» de una oferta (C2-2): de 1 a 5 puntos en cada lista, en
 * lenguaje llano, armados con lo que la evaluación ya guardó (sin llamadas nuevas al modelo).
 * Server Component, sin estado.
 */
export function FitPointsPanel({ points }: { points: FitPoints }) {
  return (
    <section aria-label="Cómo te queda esta oferta" className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-card border border-line p-3 text-sm" data-testid="fit-favor">
        <h2 className="font-semibold">A tu favor</h2>
        {points.favor.length ? (
          <ul className="mt-1 flex flex-col gap-1">
            {points.favor.map((p) => (
              <li key={p.text} className="flex gap-2 text-success">
                <span aria-hidden="true" className="shrink-0">
                  ✓
                </span>
                <span className="min-w-0 break-words text-fg">{p.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-fg-subtle">
            La evaluación no encontró nada para destacar.
          </p>
        )}
      </div>
      <div className="rounded-card border border-line p-3 text-sm" data-testid="fit-falta">
        <h2 className="font-semibold">Te falta o te frena</h2>
        {points.falta.length ? (
          <ul className="mt-1 flex flex-col gap-1">
            {points.falta.map((p) => {
              const mark = FALTA_MARK[p.kind];
              return (
                <li key={p.text} className={`flex gap-2 ${mark.classes}`}>
                  <span aria-hidden="true" className="shrink-0">
                    {mark.icon}
                  </span>
                  <span className="min-w-0 break-words text-fg">
                    <span className={`font-medium ${mark.classes}`}>
                      {FALTA_KIND_LABEL[p.kind]}:{" "}
                    </span>
                    {p.text}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-fg-subtle">No encontramos nada que te frene.</p>
        )}
      </div>
    </section>
  );
}
