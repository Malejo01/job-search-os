import type { IconName } from "@/components/ui/icons";

/**
 * Las cinco secciones de la app (C9-7; C10-3, pantallas aprobadas el 4/11): las mismas en las
 * píldoras de la computadora y en las pestañas del celular. Módulo sin `"use client"`: lo leen el
 * layout (servidor) y las dos navs (cliente).
 */
export const SECTIONS: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/hoy", label: "Hoy", icon: "hoy" },
  { href: "/jobs", label: "Ofertas", icon: "ofertas" },
  { href: "/applications", label: "Postulaciones", icon: "postulaciones" },
  { href: "/cv", label: "Mi CV", icon: "cv" },
  { href: "/settings/perfil", label: "Perfil", icon: "perfil" },
];

/**
 * Lo que no entra en las cinco secciones vive en «Más», dentro de Perfil (`MoreNav`). Estando en
 * cualquiera de esas pantallas, la sección activa es Perfil.
 */
export const MORE_HREFS = ["/jobs/pending-jd", "/inbox", "/market", "/plan", "/settings"] as const;

export function activeSection(pathname: string): string | null {
  const inMore = MORE_HREFS.some((h) => pathname === h || pathname.startsWith(`${h}/`));
  if (inMore) return "/settings/perfil";
  for (const { href } of SECTIONS) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return href;
  }
  return null;
}
