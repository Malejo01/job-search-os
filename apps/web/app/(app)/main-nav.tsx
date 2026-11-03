"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavItem = {
  href: string;
  label: string;
  /** Número chico al lado del label (p. ej. postulaciones para seguimiento); con 0 o sin valor no se muestra. */
  count?: number;
};

/**
 * El número se ve dentro del link, pero queda oculto para lectores de pantalla (`aria-hidden`).
 * Así el nombre accesible del link sigue siendo el label. La versión para lectores va después
 * del link (`NavCountText`).
 */
function NavCount({ item }: { item: NavItem }) {
  if (!item.count) return null;
  return (
    <span
      data-testid="nav-count"
      aria-hidden="true"
      className="ml-1.5 rounded-pill bg-brand px-1.5 text-xs font-bold text-brand-contrast"
    >
      {item.count}
    </span>
  );
}

function NavCountText({ item }: { item: NavItem }) {
  if (!item.count) return null;
  return <span className="sr-only">{`${item.count} para hacer seguimiento`}</span>;
}

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

// Header tinta (C7-5, manual P1 a P4). El color del texto va en ACTIVE o INACTIVE, nunca en BASE:
// con dos `text-*` en la misma clase gana el que Tailwind genera después, no el último escrito.
// Sobre índigo el foco va en lima de marca (12,4:1): el índigo vivo casi no se distingue.
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

// Escritorio: la sección activa en lima con una línea de 3 px abajo (P1)
const DESKTOP_BASE = `flex min-h-11 items-center whitespace-nowrap border-b-[3px] px-1 font-semibold hover:text-on-ink ${FOCUS}`;
const DESKTOP_ACTIVE = "border-brand text-brand";
const DESKTOP_INACTIVE = "border-transparent text-on-ink-muted";

// Celular: lista dentro del «Menú», la activa en lima sobre un fondo apenas más claro
const MOBILE_BASE = `flex min-h-11 items-center rounded-control px-3 font-semibold hover:bg-ink-line ${FOCUS}`;
const MOBILE_ACTIVE = "bg-ink-line text-brand";
const MOBILE_INACTIVE = "text-on-ink-muted";

/**
 * Navegación principal. Client components solo para saber la ruta (aria-current) y cerrar el menú
 * al navegar. Desde `sm`, fila de links (`DesktopNav`); por debajo, un <details> «Menú»
 * (`MobileNav`, sin JS para abrirlo). Van en filas distintas del header y con display excluyente
 * (`hidden sm:block` / `sm:hidden`).
 */
export function DesktopNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  return (
    // `data-tour`: ancla de la guía de /jobs (ronda 92); el menú móvil lleva la suya abajo
    <nav aria-label="Secciones" className="hidden min-w-0 sm:block">
      <ul className="flex gap-x-5 gap-y-0 overflow-x-auto text-[15px]">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              data-tour={item.href === PENDING_JD_HREF ? "jobs:menu" : undefined}
              aria-current={item.href === active ? "page" : undefined}
              className={`${DESKTOP_BASE} ${item.href === active ? DESKTOP_ACTIVE : DESKTOP_INACTIVE}`}
            >
              {item.label}
              <NavCount item={item} />
            </Link>
            <NavCountText item={item} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function MobileNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  const activeLabel = items.find((i) => i.href === active)?.label ?? null;
  // Con el menú del celular cerrado, el número de pendientes se ve igual en el «Menú»
  const pending = items.reduce((n, i) => n + (i.count ?? 0), 0);
  const details = useRef<HTMLDetailsElement>(null);

  const closeMenu = () => {
    if (details.current) details.current.open = false;
  };
  // También al cambiar la ruta (atrás/adelante): el layout no se vuelve a montar
  useEffect(() => {
    if (details.current) details.current.open = false;
  }, [pathname]);

  return (
    <details ref={details} className="group px-4 pb-2 text-sm sm:hidden" data-testid="menu-movil">
      {/* Ancla de la guía en el «Menú» y no en todo el <details>: abierto, sería un recuadro enorme */}
      <summary
        data-tour="jobs:menu"
        className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-control border-2 border-ink-line px-3 font-semibold text-on-ink ${FOCUS}`}
      >
        <span>
          Menú
          {activeLabel ? <span className="font-medium text-brand"> · {activeLabel}</span> : null}
          {pending ? (
            <>
              <span
                aria-hidden="true"
                className="ml-1.5 rounded-pill bg-brand px-1.5 text-xs font-bold text-brand-contrast"
              >
                {pending}
              </span>
              <span className="sr-only">{`, ${pending} para hacer seguimiento`}</span>
            </>
          ) : null}
        </span>
        <span aria-hidden="true" className="text-on-ink-muted group-open:hidden">
          ▸
        </span>
        <span aria-hidden="true" className="hidden text-on-ink-muted group-open:inline">
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
                className={`${MOBILE_BASE} ${item.href === active ? MOBILE_ACTIVE : MOBILE_INACTIVE}`}
              >
                {item.label}
                <NavCount item={item} />
              </Link>
              <NavCountText item={item} />
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
