"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buttonClasses } from "@/components/ui/button";
import {
  PRIMER_USO_DONE,
  clampStep,
  primerUsoKey,
  shouldShowPrimerUso,
  tourSteps,
} from "@/lib/primer-uso";
import { PRIMER_USO } from "@/lib/textos-rediseno";

/**
 * Recorrido de primer uso tras el rediseño (R23-05): un diálogo con 4 pasos que aparece una sola vez
 * por persona. No usa `GuidedTour`: ese es un panel que no bloquea ni atrapa el foco y no se abre
 * solo; acá hace falta un diálogo modal (foco atrapado y devuelto, Escape cierra). Sin animación,
 * así que el movimiento reducido se respeta por construcción. Estado en `localStorage` (try/catch:
 * sin almacenamiento, el recorrido se ve en cada visita pero se puede cerrar).
 */
const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-3 text-sm text-fg aria-disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus";
const FOCUSABLE = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

const subscribeNothing = () => () => undefined;

function readEligible(userId: string): boolean {
  let stored: string | null = null;
  let forced = false;
  try {
    stored = window.localStorage.getItem(primerUsoKey(userId));
    forced = window.localStorage.getItem("jso-primer-uso-forzar") === "1";
  } catch {
    // Sin almacenamiento: se trata como no visto
  }
  return shouldShowPrimerUso({ stored, automated: navigator.webdriver === true, forced });
}

export function PrimerUso({ userId }: { userId: string }) {
  const steps = tourSteps();
  // En el servidor y en la hidratación no se muestra; en el cliente lee el almacenamiento
  const eligible = useSyncExternalStore(
    subscribeNothing,
    () => readEligible(userId),
    () => false,
  );
  const [closed, setClosed] = useState(false);
  const open = eligible && !closed;
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  // Antes de mover el foco al diálogo, recuerda dónde estaba para devolverlo al cerrar
  useEffect(() => {
    if (open && !returnTo.current) {
      returnTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(primerUsoKey(userId), PRIMER_USO_DONE);
    } catch {
      // Sin almacenamiento: se cierra igual
    }
    setClosed(true);
    returnTo.current?.focus();
  }, [userId]);

  // Foco al botón principal en cada paso
  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((el) => el.getAttribute("aria-disabled") !== "true");
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open) return null;
  const current = steps[clampStep(step, steps.length)];
  const last = step >= steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="primer-uso-titulo"
        data-testid="primer-uso"
        className="flex w-full max-w-md flex-col gap-3 rounded-control border border-line-strong bg-surface p-5 text-fg shadow-lg"
      >
        <p className="text-xs text-fg-subtle">
          {PRIMER_USO.label} · Paso {step + 1} de {steps.length}
        </p>
        <h2 id="primer-uso-titulo" className="text-lg font-semibold">
          {current?.title}
        </h2>
        <p className="text-sm leading-snug">{current?.text}</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <button
            type="button"
            className={BUTTON}
            aria-disabled={step === 0}
            onClick={() => setStep((s) => clampStep(s - 1, steps.length))}
          >
            {PRIMER_USO.back}
          </button>
          {last ? (
            <button
              type="button"
              data-primary
              className={`col-span-2 ${buttonClasses({ size: "sm" })}`}
              onClick={finish}
            >
              {PRIMER_USO.done}
            </button>
          ) : (
            <>
              <button
                type="button"
                data-primary
                className={buttonClasses({ size: "sm" })}
                onClick={() => setStep((s) => clampStep(s + 1, steps.length))}
              >
                {PRIMER_USO.next}
              </button>
              <button type="button" className={BUTTON} onClick={finish}>
                {PRIMER_USO.skip}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
