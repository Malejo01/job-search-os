import { jobTransparency, type TransparencyInput } from "@job-search-os/pipeline";
import { ContextHelp } from "@/components/context-help";
import { transparencyView } from "./transparency-view";

/**
 * Transparencia del aviso (R17-05): cuánto dice el aviso mismo, no si te conviene. Se calcula al
 * mostrar, con campos que la página ya trae (sin columna ni consulta nuevas).
 */
export function TransparencyBlock({ input }: { input: TransparencyInput }) {
  const view = transparencyView(jobTransparency(input));
  return (
    <section
      aria-labelledby="transparencia-titulo"
      data-testid="transparencia"
      className="rounded-card border border-line p-3 text-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 id="transparencia-titulo" className="font-semibold">
            Transparencia del aviso
          </h2>
          <ContextHelp slug="transparencia-del-aviso" term="transparencia del aviso" />
        </div>
        <p className="text-fg" data-testid="transparencia-puntaje">
          <span className="font-semibold">{view.scoreText}/10</span> · {view.word}
        </p>
      </div>
      {view.missing.length ? (
        <>
          <p className="mt-2 text-xs text-fg-muted">El aviso no dice:</p>
          <ul className="mt-1 list-disc pl-5 text-fg" data-testid="transparencia-faltan">
            {view.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">El aviso informa todo lo que miramos.</p>
      )}
    </section>
  );
}
