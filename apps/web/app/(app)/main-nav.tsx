"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
export function NavCount({ count, active }: { count?: number; active: boolean }) {
  if (!count) return null;
  return (
    <span
      data-testid="nav-count"
      aria-hidden="true"
      className={`ml-1.5 rounded-pill px-1.5 text-xs font-extrabold ${
        // Sin lima (decisión 2): blanco sobre índigo; en la píldora activa (lima), índigo
        active ? "bg-ink text-on-ink" : "bg-on-ink text-ink"
      }`}
    >
      {count}
    </span>
  );
}

export function NavCountText({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="sr-only">{`${count} para hacer seguimiento`}</span>;
}

/**
 * La sección activa es la de href más largo que prefija la ruta: /jobs/pending-jd no marca
 * "Ofertas" y /jobs/abc sí.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}

/** Link «Sin descripción»: ancla de la guía de /jobs en la computadora. */
const PENDING_JD_HREF = "/jobs/pending-jd";

// Barra índigo (C9-7, decisión 6): el menú en píldoras; la sección activa es una píldora lima (uno
// de los tres lugares de la lima). Sobre índigo el foco va en lima (12,4:1). El color del texto va
// en ACTIVE o INACTIVE, nunca en BASE: con dos `text-*` gana el que Tailwind genera después.
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
const PILL_BASE = `inline-flex min-h-11 items-center whitespace-nowrap rounded-pill px-3.5 text-[15px] font-bold ${FOCUS}`;
const PILL_ACTIVE = "bg-brand text-brand-contrast";
const PILL_INACTIVE = "text-on-ink-muted hover:bg-ink-line hover:text-on-ink";

/**
 * Navegación de la computadora (desde `sm`): una fila de píldoras dentro de la barra índigo. En el
 * celular no se ve: ahí van las pestañas de abajo (`MobileTabBar`). Client component solo para
 * marcar la sección activa (`aria-current`).
 */
export function DesktopNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const active = activeHref(
    pathname,
    items.map((i) => i.href),
  );
  return (
    <nav aria-label="Secciones" className="hidden min-w-0 sm:block">
      <ul className="flex gap-x-1 overflow-x-auto py-1">
        {items.map((item) => {
          const isActive = item.href === active;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                data-tour={item.href === PENDING_JD_HREF ? "jobs:menu" : undefined}
                aria-current={isActive ? "page" : undefined}
                className={`${PILL_BASE} ${isActive ? PILL_ACTIVE : PILL_INACTIVE}`}
              >
                {item.label}
                <NavCount count={item.count} active={isActive} />
              </Link>
              <NavCountText count={item.count} />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
