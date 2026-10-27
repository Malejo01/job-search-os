"use client";

import type { ProposalDestination } from "@job-search-os/pipeline";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  allowedField,
  PROPOSAL_EVENT,
  takeProposal,
  type StoredProposal,
} from "./assistant-proposal";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function fieldsNamed(form: HTMLFormElement, name: string): Field[] {
  return Array.from(form.elements).filter(
    (el): el is Field =>
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement) &&
      el.name === name &&
      // Los ocultos de la página (versión, ids) y los que agrega el cargador no se tocan acá
      !(el instanceof HTMLInputElement && el.type === "hidden"),
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

/**
 * Carga los valores en campos NO controlados del formulario (criterios, skills), por nombre y
 * solo de la lista cerrada del destino. Devuelve qué no encontró en la página: en «Tus skills»,
 * esos `level:<slug>` van como campos ocultos que pinta el cargador (antes de las filas: si después
 * aparece una fila visible de esa skill con un nivel marcado, ese gana, porque se lee último).
 */
export function applyFormValues(
  form: HTMLFormElement,
  values: Record<string, string | string[]>,
  destination: ProposalDestination,
): { missing: string[] } {
  const missing: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!allowedField(destination, name)) continue;
    const els = fieldsNamed(form, name);
    if (els.length === 0) {
      missing.push(name);
      continue;
    }
    for (const el of els) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        el.checked = Array.isArray(value) ? value.includes(el.value) : value === el.value;
      } else {
        setText(el, Array.isArray(value) ? value.join("\n") : value);
      }
    }
  }
  return { missing };
}

/**
 * Aviso de propuesta cargada. El contenedor `role="status"` existe siempre (vacío) y se llena al
 * cargar; recibe el foco para que se lea entero. Se vacía cuando la persona envía el formulario.
 */
export function ProposalLoadedNotice({
  proposal,
  missing = [],
  noticeRef,
}: {
  proposal: StoredProposal | null;
  missing?: string[];
  noticeRef?: RefObject<HTMLDivElement | null>;
}) {
  const labels = new Map(proposal?.diffs.map((d) => [d.field, d.label]) ?? []);
  return (
    <div
      ref={noticeRef}
      role="status"
      tabIndex={-1}
      data-testid={proposal ? "assistant-proposal-loaded" : undefined}
      className={
        proposal
          ? "flex flex-col gap-1 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
          : "sr-only"
      }
    >
      {proposal ? (
        <>
          <p className="font-medium">
            Cargamos la propuesta del asistente. Revisá los cambios y tocá Guardar: todavía no se
            guardó nada.
          </p>
          {proposal.diffs.length > 0 ? (
            <ul className="list-disc pl-5">
              {proposal.diffs.map((d) => (
                <li key={d.field} className="break-words">
                  {d.label}: {d.after}
                </li>
              ))}
            </ul>
          ) : null}
          {missing.length > 0 ? (
            <p className="text-amber-900">
              No se pudo cargar en esta pantalla:{" "}
              {missing.map((m) => labels.get(m) ?? m).join(", ")}.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Vacía el aviso cuando la persona envía el formulario (ya no es «sin guardar»). */
export function useClearOnSubmit(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  clear: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const form = ref.current?.closest("form");
    if (!form) return;
    form.addEventListener("submit", clear);
    return () => form.removeEventListener("submit", clear);
  }, [ref, active, clear]);
}

type Loaded = { proposal: StoredProposal; missing: string[]; hidden: [string, string][] };

/**
 * Cargador para formularios no controlados (criterios y skills). Va DENTRO del `<form>`: toma la
 * propuesta guardada al montar, o cuando llega con la persona ya en la pantalla, y la carga. No
 * envía nada. En criterios, si la versión de la página no es la de la propuesta, no carga.
 */
export function AssistantProposalLoader({
  destination,
}: {
  destination: Extract<ProposalDestination, "criteria" | "skill_levels">;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // Lee sessionStorage (afuera de React) al montar y cuando el panel avisa con la pantalla abierta
    const load = () => {
      const form = ref.current?.closest("form");
      if (!form) return;
      const proposal = takeProposal(destination);
      if (!proposal) return;
      if (destination === "criteria") {
        const version = (form.elements.namedItem("baseVersion") as HTMLInputElement | null)?.value;
        if (proposal.criteriaVersion === null || String(proposal.criteriaVersion) !== version) {
          setStale(true);
          setLoaded(null);
          return;
        }
      }
      const { missing } = applyFormValues(form, proposal.formValues, destination);
      // Skills sin fila a la vista: van como ocultos que pinta el cargador; el resto no se pudo
      const hidden: [string, string][] = [];
      const notLoaded: string[] = [];
      for (const name of missing) {
        const value = proposal.formValues[name];
        if (destination === "skill_levels" && typeof value === "string") hidden.push([name, value]);
        else notLoaded.push(name);
      }
      setStale(false);
      setLoaded({ proposal, missing: notLoaded, hidden });
      setShowNotice(true);
      requestAnimationFrame(() => noticeRef.current?.focus({ preventScroll: false }));
    };
    load();
    window.addEventListener(PROPOSAL_EVENT, load);
    return () => window.removeEventListener(PROPOSAL_EVENT, load);
  }, [destination]);

  // Al enviar se vacía el aviso; los ocultos quedan (se envían en este mismo submit)
  useClearOnSubmit(ref, showNotice, () => setShowNotice(false));

  return (
    <div ref={ref}>
      {loaded?.hidden.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} data-asistente="" />
      ))}
      {stale ? (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Los criterios cambiaron desde que se armó la propuesta. Pedile al asistente una nueva.
        </p>
      ) : null}
      <ProposalLoadedNotice
        proposal={showNotice ? (loaded?.proposal ?? null) : null}
        missing={loaded?.missing ?? []}
        noticeRef={noticeRef}
      />
    </div>
  );
}
