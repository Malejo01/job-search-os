"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Mientras haya algo evaluándose (JS-027), vuelve a pedir los datos del Server Component cada
 * pocos segundos, sin recargar la página. Se corta solo al rato: si el modelo tarda más, el
 * mensaje queda en la cola y lo toma el cron.
 */
export function AutoRefresh({
  active,
  everyMs = 3000,
  maxMs = 3 * 60 * 1000,
}: {
  active: boolean;
  everyMs?: number;
  maxMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started > maxMs) window.clearInterval(id);
      else router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs, maxMs, router]);
  return null;
}
