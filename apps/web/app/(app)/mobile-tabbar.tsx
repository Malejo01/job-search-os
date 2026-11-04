"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { NavCount, NavCountText } from "./main-nav";
import { activeSection, SECTIONS } from "./sections";

/**
 * Pestañas fijas abajo en el celular (C9-7; C10-3, `.tabs` y `.tab` del tablero aprobado el 4/11):
 * Hoy, Ofertas, Postulaciones, Mi CV y Perfil. Barra blanca con borde de arriba de 2 px; cada
 * pestaña es el ícono y el nombre (11 px 700), y la activa lleva el ícono dentro de una píldora lima
 * de 44×28. Solo por debajo de `sm`; en la computadora son las píldoras de arriba. Respeta la zona
 * segura de abajo del iPhone. Lo que no entra está en Perfil, en «Más».
 *
 * Se llama «Secciones», como la nav de la computadora: en cada ancho hay una sola a la vista.
 * Perfil es el ancla de la guía de /jobs en el celular («Sin descripción» está en Más).
 */
export function MobileTabBar({ followUps = 0 }: { followUps?: number }) {
  const pathname = usePathname();
  const active = activeSection(pathname);
  return (
    <nav
      aria-label="Secciones"
      data-testid="tabbar"
      className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-surface px-2 pt-2 pb-[calc(22px+env(safe-area-inset-bottom,0px))] sm:hidden"
    >
      <ul className="m-0 flex list-none justify-between p-0">
        {SECTIONS.map((t) => {
          const isActive = t.href === active;
          const count = t.href === "/applications" ? followUps : 0;
          return (
            <li key={t.href} className="w-[72px] min-w-0">
              <Link
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                data-tour={t.href === "/settings/perfil" ? "jobs:menu" : undefined}
                className={`flex min-h-11 flex-col items-center gap-[3px] rounded-control text-[11px] leading-tight font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                  isActive ? "text-fg" : "text-fg-subtle hover:text-fg"
                }`}
              >
                <span
                  data-testid="tab-icono"
                  className={`relative flex h-7 w-11 items-center justify-center rounded-[14px] ${
                    isActive ? "bg-brand text-brand-contrast" : ""
                  }`}
                >
                  <Icon name={t.icon} size={18} />
                  {count ? (
                    <span className="absolute -top-1.5 left-7">
                      <NavCount count={count} active={isActive} />
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate">{t.label}</span>
              </Link>
              <NavCountText count={count} />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
