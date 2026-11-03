"use client";

import type { Proposal } from "@job-search-os/pipeline";
import { buttonClasses } from "@/components/ui";

export type ProposalStatus = "pendiente" | "cargada" | "descartada";

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
      className="flex flex-col gap-2 rounded-card border-2 border-info-line bg-surface p-4 text-sm"
    >
      <h3 className="font-bold break-words">{proposal.title}</h3>
      <dl className="flex flex-col gap-2">
        {proposal.diffs.map((d) => (
          <div
            key={d.field}
            className="flex flex-col gap-0.5 rounded-control bg-surface-subtle px-2 py-1.5"
          >
            <dt className="font-medium break-words">{d.label}</dt>
            <dd className="break-words">
              <span className="text-fg-subtle">Antes:</span> {d.before}
            </dd>
            <dd className="break-words">
              <span className="text-fg-subtle">Después:</span>{" "}
              <span className="font-medium">{d.after}</span>
            </dd>
            <dd className="break-words text-xs text-fg-muted">
              <span className="text-fg-subtle">De dónde sale:</span> «{d.source.quote}»,{" "}
              {d.source.from === "message" ? "de lo que escribiste" : "de tu perfil"}
            </dd>
          </div>
        ))}
      </dl>
      {proposal.warnings.length > 0 ? (
        <p className="rounded-control bg-warning-soft px-2 py-1.5 text-xs text-warning">
          Antes de guardar, revisá también estos campos del formulario, que hoy no pasan la
          validación: {proposal.warnings.join(", ")}.
        </p>
      ) : null}
      {status === "pendiente" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onLoad} className={buttonClasses({ size: "sm" })}>
            Cargar en el formulario
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Descartar
          </button>
        </div>
      ) : (
        <p ref={statusRef} tabIndex={-1} className="text-xs text-fg-muted">
          {status === "cargada"
            ? "Cargada en el formulario. Se guarda solo si tocás Guardar ahí."
            : "Descartada. No se cambió nada."}
        </p>
      )}
    </section>
  );
}
