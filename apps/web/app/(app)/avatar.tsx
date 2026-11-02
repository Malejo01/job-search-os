import { initials } from "@job-search-os/pipeline";
import Link from "next/link";
import { Icon } from "@/components/ui";

/**
 * Avatar del header (C7-5, manual P1 y P4): círculo naranja con las iniciales en tinta. Lleva a
 * «Tu perfil». Sin nombre, el ícono de perfil. Server Component.
 */
export function Avatar({ name }: { name: string | null }) {
  const letters = name ? initials(name) : null;
  return (
    <Link
      href="/settings/perfil"
      aria-label={name ? `Perfil de ${name}` : "Perfil"}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-pill bg-brand text-sm font-extrabold text-brand-contrast"
      >
        {letters ?? <Icon name="perfil" size={20} />}
      </span>
    </Link>
  );
}
