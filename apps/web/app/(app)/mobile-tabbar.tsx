"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { NavCount, NavCountText } from "./main-nav";

const TABS: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/hoy", label: "Hoy", icon: "hoy" },
  { href: "/jobs", label: "Ofertas", icon: "ofertas" },
  { href: "/applications", label: "Postulaciones", icon: "postulaciones" },
  { href: "/cv", label: "Mi CV", icon: "cv" },
  { href: "/settings/perfil", label: "Perfil", icon: "perfil" },
];

/**
 * Lo que no entra en las cinco pestañas vive en «Más», dentro de Perfil (`MoreNav`). Estando en
 * cualquiera de esas pantallas, la pestaña activa es Perfil.
 */
export const MORE_HREFS = ["/jobs/pending-jd", "/inbox", "/market", "/plan", "/settings"] as const;

export function activeTab(pathname: string): string | null {
  const inMore = MORE_HREFS.some((h) => pathname === h || pathname.startsWith(`${h}/`));
  if (inMore) return "/settings/perfil";
  for (const { href } of TABS) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return href;
  }
  return null;
}

/**
 * Pestañas fijas abajo en el celular (C9-7, decisión 6, N2; parte de la R-3 de C8): Hoy, Ofertas,
 * Postulaciones, Mi CV y Perfil, la activa en lima. Solo por debajo de `sm`; en la computadora el
 * menú son las píldoras de arriba. Respeta la zona segura de abajo del iPhone. Desde C9 van
 * siempre (antes, detrás de `MOBILE_TABBAR_ENABLED`) y reemplazan al «Menú» de arriba.
 *
 * Se llama «Secciones», como la nav de la computadora: en cada ancho hay una sola a la vista.
 * Perfil es el ancla de la guía de /jobs en el celular («Sin descripción» está en Más).
 */
export function MobileTabBar({ followUps = 0 }: { followUps?: number }) {
  const pathname = usePathname();
  const active = activeTab(pathname);
  return (
    <nav
      aria-label="Secciones"
      data-testid="tabbar"
      className="fixed inset-x-0 bottom-0 z-30 bg-ink pb-[env(safe-area-inset-bottom,0px)] text-on-ink sm:hidden"
    >
      <ul className="m-0 grid list-none grid-cols-5 gap-1 px-1.5 py-1.5">
        {TABS.map((t) => {
          const isActive = t.href === active;
          const count = t.href === "/applications" ? followUps : 0;
          return (
            <li key={t.href} className="min-w-0">
              <Link
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                data-tour={t.href === "/settings/perfil" ? "jobs:menu" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 text-[10px] leading-tight font-bold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                  isActive
                    ? "bg-brand text-brand-contrast"
                    : "text-on-ink-muted hover:bg-ink-line hover:text-on-ink"
                }`}
              >
                <span className="relative">
                  <Icon name={t.icon} size={20} />
                  {count ? (
                    <span className="absolute -top-1.5 left-3.5">
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
