"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Vueltas al ritmo base antes de empezar a espaciar: el resultado típico llega en esas. */
const FAST_TICKS = 3;
/** Cuánto crece la espera después de las vueltas rápidas, y hasta dónde (C-7a). */
const BACKOFF = 1.5;
const MAX_STEP_MS = 10_000;

/**
 * Mientras haya algo evaluándose (JS-027), vuelve a pedir los datos del Server Component sin
 * recargar la página. Las primeras vueltas van a `everyMs`; después la espera crece hasta 10 s (o
 * `everyMs`, si es más largo), porque cada vuelta es un render completo con sus consultas (C-7).
 * Con la pestaña oculta no pide nada y, al volver, pide enseguida. Se corta solo al rato: si el
 * modelo tarda más, el mensaje queda en la cola y lo toma el cron.
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
    const cap = Math.max(everyMs, MAX_STEP_MS);
    let ticks = 0;
    let timer: number | undefined;
    const expired = () => Date.now() - started > maxMs;
    const schedule = () => {
      const wait = ticks < FAST_TICKS ? everyMs : Math.min(cap, everyMs * BACKOFF ** (ticks - 2));
      timer = window.setTimeout(tick, wait);
    };
    const tick = () => {
      if (expired()) return;
      if (!document.hidden) router.refresh();
      ticks += 1;
      schedule();
    };
    // Al volver a la pestaña pide ya y reprograma: así el timer pendiente no pide otra vez enseguida
    const onVisible = () => {
      if (document.hidden || expired()) return;
      router.refresh();
      window.clearTimeout(timer);
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, everyMs, maxMs, router]);
  return null;
}
