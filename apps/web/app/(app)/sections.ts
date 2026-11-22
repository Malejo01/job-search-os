import type { IconName } from "@/components/ui/icons";

/**
 * Las cinco secciones de la app: las mismas, en el mismo orden, en las píldoras de la computadora
 * y en las pestañas del celular. Las URLs no cambian (`/jobs`, `/applications`); cambian las
 * etiquetas. Módulo sin `"use client"`: lo leen el layout (servidor) y las dos navs (cliente).
 */
export const SECTIONS: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/hoy", label: "Hoy", icon: "hoy" },
  { href: "/jobs", label: "Match", icon: "ofertas" },
  { href: "/cv", label: "CV", icon: "cv" },
  { href: "/applications", label: "Tracker", icon: "postulaciones" },
  { href: "/interview", label: "Interview", icon: "charla" },
];

/**
 * Lo que no entra en las cinco secciones vive en «Más», dentro de Perfil (`MoreNav`, al que se llega
 * por el avatar de la barra): Academy, Perfil, Ajustes y el resto. Estando en cualquiera de esas
 * pantallas no hay sección activa. «Sin descripción» (`/jobs/pending-jd`) es trabajo con las
 * ofertas: está en «Más» pero marca Match, porque cae bajo `/jobs`.
 */
export const MORE_HREFS = [
  "/academy",
  "/inbox",
  "/market",
  "/plan",
  "/encaje",
  "/settings",
] as const;

export function activeSection(pathname: string): string | null {
  const inMore = MORE_HREFS.some((h) => pathname === h || pathname.startsWith(`${h}/`));
  if (inMore) return null;
  for (const { href } of SECTIONS) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return href;
  }
  return null;
}
