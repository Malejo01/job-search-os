"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavPending } from "./nav-pending";
import { activeSection, SECTIONS } from "./sections";

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

// Píldoras de la barra índigo (C10-3, `.pill` y `.pon` del tablero aprobado el 4/11): 14 px 700 en
// `#C7C6E6`, 9×16; la activa en lima con texto índigo (uno de los tres lugares de la lima). Miden
// 37 px como la referencia y el área que se toca llega a 44 con un margen invisible. Sobre índigo
// el foco va en lima (12,4:1). El color del texto va en ACTIVE o INACTIVE, nunca en BASE.
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
const PILL_BASE = `relative inline-flex items-center whitespace-nowrap rounded-pill px-4 py-[9px] text-sm leading-[1.35] font-bold before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${FOCUS}`;
const PILL_ACTIVE = "bg-brand text-brand-contrast";
const PILL_INACTIVE = "text-on-ink-muted hover:bg-ink-line hover:text-on-ink";

/**
 * Navegación de la computadora (desde `sm`): las cinco secciones en píldoras dentro de la barra
 * índigo, las mismas que las pestañas del celular (`SECTIONS`). Lo demás está en Perfil, en «Más».
 * En el celular no se ve: ahí van las pestañas de abajo (`MobileTabBar`). Client component solo
 * para marcar la sección activa (`aria-current`). Perfil es el ancla de la guía de /jobs («Sin
 * descripción» está en «Más»).
 */
export function DesktopNav({ followUps = 0 }: { followUps?: number }) {
  const pathname = usePathname();
  const active = activeSection(pathname);
  return (
    <nav aria-label="Secciones" className="hidden min-w-0 sm:block">
      <ul className="m-0 flex list-none gap-x-1 p-0">
        {SECTIONS.map((item) => {
          const isActive = item.href === active;
          const count = item.href === "/applications" ? followUps : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                data-tour={item.href === "/settings/perfil" ? "jobs:menu" : undefined}
                aria-current={isActive ? "page" : undefined}
                className={`${PILL_BASE} ${isActive ? PILL_ACTIVE : PILL_INACTIVE}`}
              >
                {item.label}
                <NavCount count={count} active={isActive} />
                <NavPending className="inset-x-4 bottom-0.5" />
              </Link>
              <NavCountText count={count} />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
