"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";

const TABS: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/hoy", label: "Hoy", icon: "hoy" },
  { href: "/jobs", label: "Ofertas", icon: "ofertas" },
  { href: "/jobs/pending-jd", label: "Pendientes", icon: "pegar" },
  { href: "/settings/perfil", label: "Perfil", icon: "perfil" },
];

/** La pestaña activa es la de href más largo que prefija la ruta (/jobs/pending-jd no marca «Ofertas»). */
function activeTab(pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of TABS) {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}

/**
 * Barra de pestañas de abajo en el celular (reserva R-3, manual P4): Hoy, Ofertas, Pendientes y Perfil.
 * Solo por debajo de `sm`; el «Menú» de arriba sigue igual (la guía y los e2e se anclan ahí). La
 * prende `MOBILE_TABBAR_ENABLED=1` en el layout. Client Component solo para marcar la activa.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const active = activeTab(pathname);
  return (
    <nav
      aria-label="Pestañas"
      data-testid="tabbar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-line bg-ink pb-[env(safe-area-inset-bottom,0px)] text-on-ink sm:hidden"
    >
      <ul className="m-0 grid list-none grid-cols-4 p-0">
        {TABS.map((t) => {
          const isActive = t.href === active;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                  isActive ? "text-brand" : "text-on-ink-muted hover:text-on-ink"
                }`}
              >
                <Icon name={t.icon} size={20} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
