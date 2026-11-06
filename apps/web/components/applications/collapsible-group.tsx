"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useId, useState, type ReactNode } from "react";

/**
 * Grupo plegable de /applications (R4-07). Recibe el contenido ya renderizado en el servidor; solo
 * maneja abrir y cerrar, con la altura animada (sin transición si la persona pidió menos movimiento).
 * El panel cerrado no se dibuja: queda fuera del orden de tabulación.
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
  const reduce = useReducedMotion();
  const panelId = useId();
  const headingId = useId();
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
          onClick={() => setOpen((v) => !v)}
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
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={panelId}
            key="panel"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 sm:p-5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
