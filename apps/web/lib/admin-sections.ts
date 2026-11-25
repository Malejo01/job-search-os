/**
 * Secciones del panel /admin (ADM-1), en el orden de la barra. Una sola lista para la barra lateral del
 * escritorio, las pestañas del celular y la portada. Sin imports: la lee también el test de la navegación.
 *
 * Academy queda en /settings/academy porque también la usan los testers (no es solo de admins).
 */
export const ADMIN_SECTIONS = [
  { id: "inicio", href: "/admin", label: "Inicio", hint: "Lo pendiente de hoy" },
  { id: "personas", href: "/admin/personas", label: "Personas", hint: "Cuentas, roles y bloqueos" },
  {
    id: "accesos",
    href: "/admin/invitations",
    label: "Accesos",
    hint: "Invitaciones y lista de espera",
  },
  {
    id: "planes",
    href: "/admin/planes",
    label: "Planes",
    hint: "Altas, renovaciones y avisos de pago",
  },
  {
    id: "metricas",
    href: "/admin/metricas",
    label: "Métricas",
    hint: "Uso de la beta por carrera",
  },
  { id: "costos", href: "/admin/costos", label: "Costos", hint: "Gasto de IA y márgenes" },
  { id: "salud", href: "/admin/salud", label: "Salud", hint: "Fallas, topes y anomalías" },
  {
    id: "feedback",
    href: "/admin/feedback",
    label: "Feedback",
    hint: "Lo que escriben las personas",
  },
  {
    id: "informes",
    href: "/admin/informes",
    label: "Informes",
    hint: "Informes de revisión de las testers",
  },
  {
    id: "apertura",
    href: "/admin/apertura",
    label: "Apertura",
    hint: "Checklist para abrir la beta",
  },
  { id: "academy", href: "/settings/academy", label: "Academy", hint: "Revisión de fichas" },
  { id: "textos", href: "/admin/textos", label: "Textos", hint: "Textos para revisar" },
  { id: "marca", href: "/admin/marca", label: "Marca", hint: "Colores, componentes y emails" },
] as const;

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]["id"];

/** Qué sección está activa para una ruta: la de prefijo más largo; la portada solo en `/admin` exacto. */
export function activeAdminSection(pathname: string): AdminSectionId | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: { id: AdminSectionId; len: number } | null = null;
  for (const s of ADMIN_SECTIONS) {
    const match =
      s.href === "/admin" ? path === "/admin" : path === s.href || path.startsWith(`${s.href}/`);
    if (match && (!best || s.href.length > best.len)) best = { id: s.id, len: s.href.length };
  }
  return best?.id ?? null;
}
