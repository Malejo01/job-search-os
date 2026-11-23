"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Grupo plegable de /applications (R4-07). Recibe el contenido ya renderizado en el servidor; solo
 * maneja abrir y cerrar, con la altura animada (sin transición si la persona pidió menos movimiento).
 * El panel cerrado no se dibuja: queda fuera del orden de tabulación. R24-04b: la altura se anima con
 * la Web Animations API, sin Framer Motion en el cliente.
 */
export function CollapsibleGroup({
  title,
  count,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // `shown`: el panel está en el DOM; sigue un momento después de cerrar, mientras se anima la salida.
  const [shown, setShown] = useState(defaultOpen);
  const panel = useRef<HTMLDivElement>(null);
  const animateIn = useRef(false);
  const panelId = useId();
  const headingId = useId();

  // Al abrirse (no en el primer dibujo): la altura crece desde 0.
  useLayoutEffect(() => {
    if (!animateIn.current || !shown) return;
    animateIn.current = false;
    const el = panel.current;
    if (!el || !el.animate || prefersReducedMotion()) return;
    el.animate(
      [
        { height: "0px", opacity: 0 },
        { height: `${el.scrollHeight}px`, opacity: 1 },
      ],
      { duration: 200, easing: "ease-out" },
    );
  }, [shown, open]);

  function toggle() {
    const el = panel.current;
    el?.getAnimations?.().forEach((a) => a.cancel());
    if (!open) {
      animateIn.current = true;
      setOpen(true);
      setShown(true);
      return;
    }
    setOpen(false);
    if (!el || !el.animate || prefersReducedMotion()) {
      setShown(false);
      return;
    }
    const out = el.animate(
      [
        { height: `${el.scrollHeight}px`, opacity: 1 },
        { height: "0px", opacity: 0 },
      ],
      { duration: 200, easing: "ease-out", fill: "forwards" },
    );
    out.onfinish = () => setShown(false);
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className="overflow-hidden rounded-card border border-line bg-surface"
    >
      <h2 id={headingId} className="text-base font-bold text-fg">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="flex min-h-11 w-full items-center justify-between gap-2 bg-surface-muted px-4 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <span>
            {title}
            {count === undefined ? "" : ` (${count})`}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={open ? "rotate-180" : ""}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </h2>
      {shown ? (
        <div id={panelId} ref={panel} className="overflow-hidden">
          <div className="p-4 sm:p-5">{children}</div>
        </div>
      ) : null}
    </section>
  );
}
