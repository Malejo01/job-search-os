"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Recorrido guiado de la demo (ronda 74): 5 pasos en un panel fijo abajo que no bloquea la página.
 * Resalta con un `outline` el elemento con `data-tour-step`. Se abre solo con "Ver recorrido": no
 * se autoabre. Sin animación: no hay nada que ajustar para `prefers-reduced-motion`.
 */
const STEPS = [
  { title: "Este es el perfil", text: "Es una persona inventada: lo que sabe y lo que busca." },
  { title: "El puntaje", text: "De 0 a 10: qué tan bien calza la oferta con este perfil." },
  {
    title: "Por qué sí y por qué no",
    text: "Lo que juega a favor, y lo que falta, impide o arriesga.",
  },
  { title: "La acción sugerida", text: "Qué haría el sistema. La decisión siempre es tuya." },
  { title: "¿Querés probarlo con tu perfil?", text: "Pedí acceso y cargá el tuyo." },
] as const;

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 disabled:opacity-50";

function clearHighlight() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-tour-step]")) {
    el.style.outline = "";
    el.style.outlineOffset = "";
    el.style.scrollMarginTop = "";
    el.style.scrollMarginBottom = "";
  }
}

export function Tour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Alto real del panel: el espaciador y el margen de scroll lo usan para que no tape lo resaltado
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const measure = () => setPanelHeight(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  useEffect(() => {
    clearHighlight();
    if (!open) return;
    const el = document.querySelector<HTMLElement>(`[data-tour-step="${step + 1}"]`);
    if (el) {
      el.style.outline = "3px solid #18181b";
      el.style.outlineOffset = "2px";
      el.style.scrollMarginTop = "16px";
      el.style.scrollMarginBottom = `${panelHeight + 16}px`;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
    return clearHighlight;
  }, [open, step, panelHeight]);

  const current = STEPS[step] ?? STEPS[0];
  const last = step === STEPS.length - 1;

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white"
      >
        Ver recorrido
      </button>
      {open ? <div aria-hidden="true" style={{ height: panelHeight }} /> : null}
      <aside
        ref={panelRef}
        aria-label="Recorrido guiado"
        data-testid="demo-tour"
        hidden={!open}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-300 bg-white px-4 py-2 shadow-lg"
      >
        <div aria-live="polite" className="mx-auto flex max-w-5xl flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs text-zinc-600">
              Paso {step + 1} de {STEPS.length}
            </span>
            <p ref={titleRef} tabIndex={-1} className="text-base font-semibold outline-none">
              {current.title}
            </p>
          </div>
          <p className="text-sm text-zinc-800">{current.text}</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Anterior
            </button>
            {last ? (
              <Link
                href="/acceso"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white"
              >
                Pedir acceso
              </Link>
            ) : (
              <button type="button" className={BUTTON} onClick={() => setStep((s) => s + 1)}>
                Siguiente
              </button>
            )}
            <button type="button" className={BUTTON} onClick={close}>
              {last ? "Cerrar" : "Saltar"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
