import Link from "next/link";
import { Icon, type IconName } from "@/components/ui";

const MORE: ReadonlyArray<{ href: string; label: string; icon: IconName; hint: string }> = [
  {
    href: "/jobs/pending-jd",
    label: "Sin descripción",
    icon: "pegar",
    hint: "Avisos que llegaron sin texto",
  },
  { href: "/inbox", label: "Emails", icon: "alertas", hint: "Las alertas que reenviaste" },
  { href: "/market", label: "Mercado", icon: "fortalezas", hint: "Qué piden los avisos" },
  { href: "/plan", label: "Plan", icon: "afinar", hint: "Qué sumar para acercarte" },
  { href: "/settings", label: "Ajustes", icon: "filtro", hint: "Puestos, apariencia y cuenta" },
];

/**
 * «Más» (C9-7, decisión 6): en el celular las pestañas de abajo son cinco; lo que no entra vive
 * acá, dentro de Perfil. Solo por debajo de `sm`: en la computadora todo está en las píldoras de
 * arriba. Server Component.
 */
export function MoreNav() {
  return (
    <nav
      aria-labelledby="mas-titulo"
      data-testid="mas"
      className="flex flex-col gap-2 rounded-card bg-surface p-4 sm:hidden"
    >
      <h2 id="mas-titulo" className="text-heading font-bold">
        Más
      </h2>
      <ul className="flex flex-col">
        {MORE.map((m) => (
          <li key={m.href}>
            <Link
              href={m.href}
              className="flex min-h-12 items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Icon name={m.icon} size={20} className="text-brand-text" />
              <span className="flex min-w-0 flex-col">
                <span className="font-bold text-fg">{m.label}</span>
                <span className="text-xs text-fg-subtle">{m.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
