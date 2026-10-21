"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavItem = { href: string; label: string };

/**
 * La sección activa es la de href más largo que prefija la ruta: /jobs/pending-jd no marca
 * "Ofertas" y /jobs/abc sí.
 */
function activeHref(pathname: string, items: readonly NavItem[]): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}

/** Link «Sin descripción»: ancla de la guía de /jobs. */
const PENDING_JD_HREF = "/jobs/pending-jd";

const LINK_BASE =
  "rounded-md px-3 text-zinc-700 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";
const LINK_ACTIVE = "bg-zinc-100 font-medium text-zinc-900";

/**
 * Navegación principal. Client component solo para saber la ruta (aria-current) y cerrar el menú
 * al navegar. Desde `sm`, fila de links; por debajo, un <details> «Menú» (sin JS para abrirlo).
 * Son dos bloques con display excluyente (`hidden sm:block` / `sm:hidden`), sin mezclar con
 * `inline-flex`: cuando conviven en una misma clase gana la que Tailwind genera después.
 */
export function MainNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  const activeLabel = items.find((i) => i.href === active)?.label ?? null;
  const details = useRef<HTMLDetailsElement>(null);

  const closeMenu = () => {
    if (details.current) details.current.open = false;
  };
  // También al cambiar la ruta (atrás/adelante): el layout no se vuelve a montar
  useEffect(() => {
    if (details.current) details.current.open = false;
  }, [pathname]);

  return (
    <>
      {/* `data-tour`: ancla de la guía de /jobs (ronda 92); el menú móvil lleva la suya abajo */}
      <nav aria-label="Secciones" className="hidden px-2 sm:block">
        <ul className="flex gap-1 text-sm">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                data-tour={item.href === PENDING_JD_HREF ? "jobs:menu" : undefined}
                aria-current={item.href === active ? "page" : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap ${LINK_BASE} ${item.href === active ? LINK_ACTIVE : ""}`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <details ref={details} className="group px-4 pb-2 text-sm sm:hidden" data-testid="menu-movil">
        {/* Ancla de la guía en el «Menú» y no en todo el <details>: abierto, sería un recuadro enorme */}
        <summary
          data-tour="jobs:menu"
          className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-md border border-zinc-300 px-3 font-medium text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
        >
          <span>
            Menú{activeLabel ? <span className="font-normal"> · {activeLabel}</span> : null}
          </span>
          <span aria-hidden="true" className="group-open:hidden">
            ▸
          </span>
          <span aria-hidden="true" className="hidden group-open:inline">
            ▾
          </span>
        </summary>
        <nav aria-label="Secciones" className="mt-1">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={item.href === active ? "page" : undefined}
                  onClick={closeMenu}
                  className={`flex min-h-11 items-center ${LINK_BASE} ${item.href === active ? LINK_ACTIVE : ""}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </details>
    </>
  );
}
