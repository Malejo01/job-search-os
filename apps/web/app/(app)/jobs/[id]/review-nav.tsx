"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Volver a la lista y moverse a la oferta anterior o siguiente con los mismos filtros (JS-061).
 * Client component solo por el atajo de teclado; los hrefs vienen resueltos del servidor, con el
 * mismo orden que la lista.
 *
 * Atajos: `j` o `n` = siguiente, `k` = anterior. No se disparan escribiendo (input, textarea,
 * select, contenteditable) ni con Ctrl/Cmd/Alt, para no pisar atajos del navegador.
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
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
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
      const key = e.key.toLowerCase();
      const href = key === "j" || key === "n" ? nextHref : key === "k" ? prevHref : null;
      if (!href) return;
      e.preventDefault();
      router.push(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, prevHref, nextHref]);

  const btn =
    "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:border-zinc-500";
  const off = "rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-300";

  return (
    <nav aria-label="Revisión de ofertas" className="flex items-center justify-between gap-2">
      <Link href={backHref} className="text-xs text-zinc-500 hover:underline">
        ← Ofertas
      </Link>
      <div className="flex items-center gap-1.5">
        {prevHref ? (
          <Link href={prevHref} className={btn} title="Atajo: k" rel="prev">
            ← Anterior
          </Link>
        ) : (
          <span className={off} aria-disabled="true">
            ← Anterior
          </span>
        )}
        {nextHref ? (
          <Link href={nextHref} className={btn} title="Atajo: j o n" rel="next">
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
