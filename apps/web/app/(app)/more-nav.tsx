import Link from "next/link";
import { Icon, type IconName } from "@/components/ui";
import { logout } from "./logout-action";

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
  // R5-C9: el glosario con las palabras de la app (puntaje, afín, prefiltro, pool…)
  {
    href: "/ayuda#glosario",
    label: "Glosario",
    icon: "pregunta",
    hint: "Qué quiere decir cada palabra",
  },
];

const ITEM =
  "flex min-h-12 w-full items-center gap-3 rounded-control px-2 py-1.5 text-left hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus";

/**
 * «Más» (C9-7; C10-3): las secciones son cinco, en las pestañas del celular y en las píldoras de
 * la computadora; lo que no entra vive acá, dentro de Perfil, en los dos anchos. También «Salir».
 * Server Component.
 */
export function MoreNav() {
  return (
    <nav
      aria-labelledby="mas-titulo"
      data-testid="mas"
      className="flex flex-col gap-2 rounded-card bg-surface p-4"
    >
      <h2 id="mas-titulo" className="text-heading font-bold">
        Más
      </h2>
      <ul className="flex flex-col">
        {MORE.map((m) => (
          <li key={m.href}>
            <Link href={m.href} className={ITEM}>
              <Icon name={m.icon} size={20} className="text-brand-text" />
              <span className="flex min-w-0 flex-col">
                <span className="font-bold text-fg">{m.label}</span>
                <span className="text-xs text-fg-subtle">{m.hint}</span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <form action={logout}>
            <button type="submit" className={ITEM}>
              <Icon name="perfil" size={20} className="text-brand-text" />
              <span className="flex min-w-0 flex-col">
                <span className="font-bold text-fg">Salir</span>
                <span className="text-xs text-fg-subtle">Cerrar la sesión en este dispositivo</span>
              </span>
            </button>
          </form>
        </li>
      </ul>
    </nav>
  );
}
