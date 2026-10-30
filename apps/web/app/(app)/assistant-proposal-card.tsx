"use client";

import type { Proposal } from "@job-search-os/pipeline";

export type ProposalStatus = "pendiente" | "cargada" | "descartada";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

/**
 * Tarjeta de diferencia (AG-3): campo, antes, después y de dónde sale cada dato. Todo como texto
 * de React (nada de HTML ni markdown): los valores pueden venir influidos por el modelo. Los botones
 * no guardan nada: «Cargar en el formulario» lleva los valores a la pantalla y la persona guarda ahí.
 */
export function AssistantProposalCard({
  proposal,
  status,
  onLoad,
  onDiscard,
  statusRef,
}: {
  proposal: Proposal;
  status: ProposalStatus;
  /** El texto de estado recibe el foco al descartar (el botón desaparece). */
  statusRef?: (el: HTMLElement | null) => void;
  onLoad: () => void;
  onDiscard: () => void;
}) {
  return (
    <section
      aria-label={proposal.title}
      data-testid="assistant-proposal"
      className="flex flex-col gap-2 rounded-md border border-sky-300 bg-white p-3 text-sm"
    >
      <h3 className="font-semibold break-words">{proposal.title}</h3>
      <dl className="flex flex-col gap-2">
        {proposal.diffs.map((d) => (
          <div key={d.field} className="flex flex-col gap-0.5 rounded-md bg-zinc-50 px-2 py-1.5">
            <dt className="font-medium break-words">{d.label}</dt>
            <dd className="break-words">
              <span className="text-zinc-600">Antes:</span> {d.before}
            </dd>
            <dd className="break-words">
              <span className="text-zinc-600">Después:</span>{" "}
              <span className="font-medium">{d.after}</span>
            </dd>
            <dd className="break-words text-xs text-zinc-700">
              <span className="text-zinc-600">De dónde sale:</span> «{d.source.quote}»,{" "}
              {d.source.from === "message" ? "de lo que escribiste" : "de tu perfil"}
            </dd>
          </div>
        ))}
      </dl>
      {proposal.warnings.length > 0 ? (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          Antes de guardar, revisá también estos campos del formulario, que hoy no pasan la
          validación: {proposal.warnings.join(", ")}.
        </p>
      ) : null}
      {status === "pendiente" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onLoad}
            className={`min-h-11 rounded-md bg-zinc-900 px-3 py-2 font-medium text-white ${FOCUS_RING}`}
          >
            Cargar en el formulario
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className={`min-h-11 rounded-md border border-zinc-400 px-3 py-2 font-medium text-zinc-900 ${FOCUS_RING}`}
          >
            Descartar
          </button>
        </div>
      ) : (
        <p ref={statusRef} tabIndex={-1} className="text-xs text-zinc-700">
          {status === "cargada"
            ? "Cargada en el formulario. Se guarda solo si tocás Guardar ahí."
            : "Descartada. No se cambió nada."}
        </p>
      )}
    </section>
  );
}
