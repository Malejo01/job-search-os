"use client";

import type { ProposalDestination } from "@job-search-os/pipeline";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PROPOSAL_EVENT, takeProposal, type StoredProposal } from "./assistant-proposal";

/** Solo en «Tus skills» se agregan filas que la página no muestra, y solo con esta forma. */
const SKILL_LEVEL_FIELD = /^level:[a-z][a-z0-9_]{0,39}$/;

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function fieldsNamed(form: HTMLFormElement, name: string): Field[] {
  return Array.from(form.elements).filter(
    (el): el is Field =>
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement) &&
      el.name === name,
  );
}

/** Cambia el valor como lo haría la persona, para que React (si el campo es controlado) se entere. */
function setText(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Un clic de verdad (casillas y radios controlados), con el render aplicado antes del siguiente. */
const click = (el: HTMLInputElement) => flushSync(() => el.click());

/**
 * Carga los valores en los campos del formulario, por nombre. Primero desmarca (así un selector
 * con tope libera lugar) y después marca y escribe. Un `level:<slug>` sin fila en la página
 * (skill que no está a la vista) va como campo oculto. Devuelve los nombres que no encontró.
 */
export function applyFormValues(
  form: HTMLFormElement,
  values: Record<string, string | string[]>,
  destination: ProposalDestination,
): string[] {
  const missing: string[] = [];
  const wantChecked = (el: HTMLInputElement, value: string | string[]) =>
    Array.isArray(value) ? value.includes(el.value) : value === el.value || value === "on";

  for (const [name, value] of Object.entries(values)) {
    for (const el of fieldsNamed(form, name)) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        if (el.checked && !wantChecked(el, value) && el.type === "checkbox") click(el);
      }
    }
  }
  for (const [name, value] of Object.entries(values)) {
    const els = fieldsNamed(form, name);
    if (els.length === 0) {
      if (
        destination === "skill_levels" &&
        SKILL_LEVEL_FIELD.test(name) &&
        typeof value === "string"
      ) {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = name;
        hidden.value = value;
        form.appendChild(hidden);
      } else {
        missing.push(name);
      }
      continue;
    }
    for (const el of els) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        if (!el.checked && wantChecked(el, value) && !el.disabled) click(el);
      } else if (el instanceof HTMLInputElement && el.type === "hidden") {
        // Los ocultos de la página (versión, ids) no se tocan
      } else if (typeof value === "string") {
        setText(el, value);
      } else {
        setText(el, value.join("\n"));
      }
    }
  }
  return missing;
}

/** Aviso fijo con lo que se cargó. Nada está guardado todavía. */
export function ProposalLoadedNotice({ proposal }: { proposal: StoredProposal }) {
  return (
    <div
      role="status"
      data-testid="assistant-proposal-loaded"
      className="flex flex-col gap-1 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950"
    >
      <p className="font-medium">
        Cargamos la propuesta del asistente. Revisá los cambios y tocá Guardar: todavía no se guardó
        nada.
      </p>
      {proposal.diffs.length > 0 ? (
        <ul className="list-disc pl-5">
          {proposal.diffs.map((d) => (
            <li key={d.field} className="break-words">
              {d.label}: {d.before} → {d.after}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Cargador genérico para formularios no controlados (criterios, skills, puestos). Va DENTRO del
 * `<form>`: toma la propuesta guardada al montar, o cuando llega con la persona ya en la pantalla,
 * y la carga en los campos. No envía nada.
 */
export function AssistantProposalLoader({ destination }: { destination: ProposalDestination }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<StoredProposal | null>(null);

  useEffect(() => {
    // Lee sessionStorage (afuera de React) al montar y cuando el panel avisa con la pantalla abierta
    const load = () => {
      const form = ref.current?.closest("form");
      if (!form) return;
      const proposal = takeProposal(destination);
      if (!proposal) return;
      applyFormValues(form, proposal.formValues, destination);
      setLoaded(proposal);
      ref.current?.scrollIntoView({ block: "nearest" });
    };
    load();
    window.addEventListener(PROPOSAL_EVENT, load);
    return () => window.removeEventListener(PROPOSAL_EVENT, load);
  }, [destination]);

  return <div ref={ref}>{loaded ? <ProposalLoadedNotice proposal={loaded} /> : null}</div>;
}
