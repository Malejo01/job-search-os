"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import { ADMIN_SECTIONS, activeAdminSection } from "@/lib/admin-sections";

/**
 * Navegación del panel /admin (ADM-1): barra lateral en escritorio y pestañas con desplazamiento horizontal
 * en el celular, las dos desde `ADMIN_SECTIONS`. Client component solo para marcar la sección activa.
 */
export function AdminNav() {
  const active = activeAdminSection(usePathname() ?? "/admin");
  return (
    <nav
      aria-label="Secciones del panel de administración"
      className="lg:sticky lg:top-4 lg:self-start"
    >
      <p className="mb-2 hidden text-xs font-bold tracking-wide text-fg-subtle uppercase lg:block">
        Administración
      </p>
      <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-b-0 lg:px-0">
        {ADMIN_SECTIONS.map((s) => {
          const current = s.id === active;
          return (
            <li key={s.id} className="shrink-0">
              <Link
                href={s.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
                  "border-b-2 lg:rounded-control lg:border-b-0",
                  current
                    ? "border-brand text-fg lg:bg-surface-muted"
                    : "border-transparent text-fg-muted hover:text-fg lg:hover:bg-surface-muted",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
