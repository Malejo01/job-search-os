"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { recordAction } from "@/lib/action-tracker";

/**
 * Registra en memoria las últimas acciones de la persona (navegación y clics en botones/links).
 * No persiste en localStorage. NUNCA lee valores de campos de formulario ni query strings.
 */
export function ActionTracker() {
  const pathname = usePathname();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    // Registra cambios de pantalla (solo pathname)
    if (pathname && pathname !== lastPathRef.current) {
      lastPathRef.current = pathname;
      recordAction({ type: "navigate", text: pathname });
    }
  }, [pathname]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest("button, a");
      if (!target) return;
      // Solo el texto visible o aria-label, nunca valores de formulario
      const label = target.getAttribute("aria-label") || target.textContent || "";
      const text = label.trim().replace(/\s+/g, " ").slice(0, 60);
      // Descartar si está vacío o si contiene '@' (para no registrar correos electrónicos)
      if (text && !text.includes("@")) {
        recordAction({ type: "click", text });
      }
    }

    window.addEventListener("click", handleClick, { capture: true, passive: true });
    return () => {
      window.removeEventListener("click", handleClick, { capture: true });
    };
  }, []);

  return null;
}
