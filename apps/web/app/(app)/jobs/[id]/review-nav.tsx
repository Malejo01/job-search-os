"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Volver a la lista y moverse a la oferta anterior o siguiente con los mismos filtros (JS-061).
 * Client component solo por el atajo de teclado; los hrefs vienen resueltos del servidor, con el
 * mismo orden que la lista.
 *
 * Atajos: `Alt+J` o `Alt+N` = siguiente, `Alt+K` = anterior. No se disparan escribiendo (input,
 * textarea, select, contenteditable) ni con Ctrl/Cmd, para no pisar atajos del navegador.
 */
export function ReviewNav({
  backHref,
  prevHref,
  nextHref,
}: {
  backHref: string;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Solo con Alt (sin Ctrl ni Meta): las letras sueltas no pisan lo que se escribe ni los atajos del navegador.
      if (e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      ) {
        return;
      }
      // e.code y no e.key: en Mac, Alt cambia el carácter (Alt+J da "∆").
      const href =
        e.code === "KeyJ" || e.code === "KeyN" ? nextHref : e.code === "KeyK" ? prevHref : null;
      if (!href) return;
      e.preventDefault();
      router.push(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, prevHref, nextHref]);

  const btn =
    "rounded-control border border-line-strong px-2.5 py-1 text-xs text-fg-muted hover:border-fg-subtle";
  const off = "rounded-control border border-line px-2.5 py-1 text-xs text-fg-subtle";

  return (
    <nav aria-label="Revisión de ofertas" className="flex items-center justify-between gap-2">
      <Link href={backHref} className="text-xs text-fg-subtle hover:underline">
        ← Ofertas
      </Link>
      <div className="flex items-center gap-1.5">
        {prevHref ? (
          <Link href={prevHref} className={btn} title="Anterior (Alt+K)" rel="prev">
            ← Anterior
          </Link>
        ) : (
          <span className={off} aria-disabled="true">
            ← Anterior
          </span>
        )}
        {nextHref ? (
          <Link href={nextHref} className={btn} title="Siguiente (Alt+J)" rel="next">
            Siguiente →
          </Link>
        ) : (
          <span className={off} aria-disabled="true">
            Siguiente →
          </span>
        )}
      </div>
    </nav>
  );
}
