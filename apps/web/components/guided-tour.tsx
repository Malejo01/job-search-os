"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Recorrido guiado reutilizable (demo pública y guía de la app, ronda 92): un panel fijo abajo que
 * no bloquea la página ni atrapa el foco, con un paso por vez y un `outline` sobre el elemento
 * marcado con `data-tour="<pantalla>:<id>"`. No se autoabre: lo abre el botón (y, si se pasa
 * `invite`, una invitación descartable). Sin animación: no hay nada que ajustar para
 * `prefers-reduced-motion`, salvo el scroll, que es instantáneo con esa preferencia.
 *
 * Va dentro de un contenedor `flex flex-wrap`: la invitación ocupa su propia fila y el panel es
 * `fixed`, así que no mueve nada.
 */
export type TourStep = {
  title: string;
  text: string;
  /** `data-tour` del elemento a resaltar; `null` = texto general. Sin el elemento en pantalla, se saltea. */
  anchor: string | null;
};

export type TourInvite = {
  text: string;
  startLabel: string;
  dismissLabel: string;
  testId: string;
};

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 aria-disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";
const BUTTON_PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";
const OPENER_DEFAULT =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";

/** Primer elemento con esa ancla que tenga caja (el menú, por ejemplo, está dos veces: según el ancho). */
function findAnchor(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)) {
    const { width, height } = el.getBoundingClientRect();
    if (width > 0 && height > 0) return el;
  }
  return null;
}

function clearHighlight() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-tour]")) {
    el.style.outline = "";
    el.style.outlineOffset = "";
    el.style.scrollMarginTop = "";
    el.style.scrollMarginBottom = "";
  }
}

export function GuidedTour({
  steps,
  label,
  testId,
  openerLabel,
  openerClassName = OPENER_DEFAULT,
  resume = false,
  finalAction,
  onDone,
  invite,
}: {
  steps: readonly TourStep[];
  /** `aria-label` del panel. */
  label: string;
  testId: string;
  openerLabel: string;
  openerClassName?: string;
  /** Cerrar con Escape no pierde el paso: al reabrir sigue donde estaba. Saltar o terminar lo reinicia. */
  resume?: boolean;
  /** Reemplaza «Siguiente» en el último paso (la demo manda a pedir acceso). Sin esto, el último paso termina con «Listo». */
  finalAction?: { label: string; href: string };
  /** Al saltar, terminar o rechazar la invitación (no al cerrar con Escape). */
  onDone?: () => void | Promise<void>;
  invite?: TourInvite | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [active, setActive] = useState<readonly TourStep[]>(steps);
  const [inviteHidden, setInviteHidden] = useState(false);
  const [panelHeight, setPanelHeight] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  // Alto del panel para el scroll sin re-render: el resaltado no se vuelve a scrollear si el panel cambia de alto
  const panelHeightRef = useRef(0);
  // Botón principal del paso («Siguiente», «Listo» o el final): recibe el foco en cada paso
  const primaryRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus();
  }, []);

  /** Saltar o terminar: cierra, vuelve al primer paso y avisa. */
  const finish = useCallback(() => {
    setStep(0);
    setInviteHidden(true);
    close();
    void onDone?.();
  }, [close, onDone]);

  function openGuide() {
    // Los pasos cuyo elemento no está en pantalla se saltean; el total («Paso N de M») cuenta los que quedan
    const visible = steps.filter((s) => s.anchor === null || findAnchor(s.anchor) !== null);
    if (visible.length === 0) return;
    setActive(visible);
    setStep((current) => (resume ? Math.min(current, visible.length - 1) : 0));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Si otro componente (un popover) ya consumió el Escape, no cierra también la guía
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Alto real del panel: el margen de scroll lo usa para que no tape lo resaltado; el padding del
  // body deja scroll al final de la página, y `--tour-panel-h` sube las barras pegadas abajo
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const measure = () => {
      panelHeightRef.current = panel.offsetHeight;
      setPanelHeight(panel.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.paddingBottom = `${panelHeight}px`;
    document.documentElement.style.setProperty("--tour-panel-h", `${panelHeight}px`);
    return () => {
      document.body.style.paddingBottom = "";
      document.documentElement.style.removeProperty("--tour-panel-h");
    };
  }, [open, panelHeight]);

  // El foco va al botón principal al abrir y en cada cambio de paso: el botón que se tocó puede
  // desaparecer (en el último paso «Siguiente» se reemplaza) y el foco caería al body. Con eso alcanza
  // un Tab por paso; el título lo anuncia la región `aria-live`
  useEffect(() => {
    if (open) primaryRef.current?.focus({ preventScroll: true });
  }, [open, step]);

  // Depende solo de open, step y active: un cambio de alto del panel no vuelve a scrollear
  useEffect(() => {
    clearHighlight();
    if (!open) return;
    const anchor = active[step]?.anchor;
    const el = anchor ? findAnchor(anchor) : null;
    if (el) {
      // El header pegajoso de la app tapa el borde de arriba: el margen suma su alto
      const sticky = document.querySelector("header");
      const headerHeight =
        sticky && ["sticky", "fixed"].includes(getComputedStyle(sticky).position)
          ? sticky.getBoundingClientRect().height
          : 0;
      el.style.outline = "3px solid #18181b";
      el.style.outlineOffset = "2px";
      el.style.scrollMarginTop = `${Math.round(headerHeight) + 16}px`;
      el.style.scrollMarginBottom = `${panelHeightRef.current + 16}px`;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
    return clearHighlight;
  }, [open, step, active]);

  const current = active[step] ?? active[0];
  const last = step === active.length - 1;
  const showInvite = invite !== undefined && !inviteHidden && !open;

  return (
    <>
      <button ref={openerRef} type="button" onClick={openGuide} className={openerClassName}>
        {openerLabel}
      </button>
      {showInvite ? (
        <div
          role="note"
          data-testid={invite.testId}
          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900"
        >
          <p>{invite.text}</p>
          <div className="flex gap-2">
            <button type="button" onClick={openGuide} className={BUTTON_PRIMARY}>
              {invite.startLabel}
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => {
                setInviteHidden(true);
                openerRef.current?.focus();
                void onDone?.();
              }}
            >
              {invite.dismissLabel}
            </button>
          </div>
        </div>
      ) : null}
      <aside
        ref={panelRef}
        aria-label={label}
        data-testid={testId}
        hidden={!open}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-300 bg-white px-4 py-1.5 shadow-lg"
      >
        <div aria-live="polite" className="mx-auto flex max-w-5xl flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs text-zinc-600">
              Paso {step + 1} de {active.length}
            </span>
            <p className="text-sm font-semibold">{current?.title}</p>
          </div>
          <p className="text-sm leading-snug text-zinc-800">{current?.text}</p>
          <div className="mt-1 grid w-full grid-cols-3 gap-2 sm:max-w-md sm:self-end">
            {/* aria-disabled y no disabled: un botón con foco que se deshabilita lo pierde */}
            <button
              type="button"
              className={BUTTON}
              aria-disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Anterior
            </button>
            {last ? (
              finalAction ? (
                <>
                  <Link
                    href={finalAction.href}
                    ref={(el) => {
                      primaryRef.current = el;
                    }}
                    className={BUTTON_PRIMARY}
                  >
                    {finalAction.label}
                  </Link>
                  <button type="button" className={BUTTON} onClick={finish}>
                    Cerrar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  ref={(el) => {
                    primaryRef.current = el;
                  }}
                  className={`col-span-2 ${BUTTON_PRIMARY}`}
                  onClick={finish}
                >
                  Listo
                </button>
              )
            ) : (
              <>
                <button
                  type="button"
                  ref={(el) => {
                    primaryRef.current = el;
                  }}
                  className={BUTTON}
                  onClick={() => setStep((s) => s + 1)}
                >
                  Siguiente
                </button>
                <button type="button" className={BUTTON} onClick={finish}>
                  Saltar
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
