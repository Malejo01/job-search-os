import { FALTA_KIND_LABEL, type FaltaKind, type FitPoints } from "@job-search-os/pipeline";
import { Icon } from "@/components/ui";

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
export function FitPointsPanel({
  points,
  limited = false,
  headingLevel = 2,
}: {
  points: FitPoints;
  /** Nivel de los dos títulos: 2 en el detalle; más abajo cuando va dentro de otra sección (demo). */
  headingLevel?: 2 | 3 | 4;
  /** Sin la descripción completa (o sin checklist): «nada que te frene» no es una promesa. */
  limited?: boolean;
}) {
  const H = `h${headingLevel}` as const;
  return (
    <section aria-label="Cómo te queda esta oferta" className="grid gap-3 sm:grid-cols-2">
      {/* C7-6: fortalezas con borde verde arriba, debilidades con borde ámbar (manual M8) */}
      <div
        className="rounded-card border border-line border-t-4 border-t-success-line bg-surface p-4 text-sm"
        data-testid="fit-favor"
      >
        <H className="flex items-center gap-2 font-display text-base font-bold">
          <Icon name="fortalezas" size={20} className="text-success" />A tu favor
        </H>
        {points.favor.length ? (
          <ul className="mt-2 flex flex-col gap-1.5">
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
          <p className="mt-2 text-xs text-fg-subtle">
            La evaluación no encontró nada para destacar.
          </p>
        )}
      </div>
      <div
        className="rounded-card border border-line border-t-4 border-t-warning-line bg-surface p-4 text-sm"
        data-testid="fit-falta"
      >
        <H className="flex items-center gap-2 font-display text-base font-bold">
          <Icon name="afinar" size={20} className="text-warning" />
          Te falta o te frena
        </H>
        {points.falta.length ? (
          <ul className="mt-2 flex flex-col gap-1.5">
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
          <p className="mt-2 text-xs text-fg-subtle">
            {limited
              ? "Con lo que dice el aviso no vimos nada que te frene; con la descripción completa puede cambiar."
              : "No encontramos nada que te frene."}
          </p>
        )}
      </div>
    </section>
  );
}
